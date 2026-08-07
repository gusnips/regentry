import { captureSnapshot, resolveRefRect } from "./snapshot";
import type { SnapshotOptions, SnapshotResult } from "./snapshot";
import {
  clickAt,
  typeText,
  insertText,
  pressKey,
  scroll,
  screenshot,
  navigateToUrl,
  ensureAttached,
} from "./cdp-driver";
import { truncate } from "@/lib/logger";
import type { TabId } from "@/shared/types";

/**
 * Driver — single interface over snapshot (scripting) + actions (CDP).
 * Exists because the two halves use different mechanisms with different failure modes.
 * This is also the test seam.
 */

/** One open tab, as the model needs to see it — labels bounded so a 100-tab session stays cheap. */
export interface TabInfo {
  id: TabId;
  windowId: number;
  title: string;
  url: string;
  active: boolean;
  favIconUrl?: string;
}

export interface BrowserDriver {
  snapshot(opts?: SnapshotOptions): Promise<SnapshotResult>;
  click(ref: string): Promise<{ x: number; y: number }>;
  type(text: string): Promise<void>;
  insert(text: string): Promise<void>;
  key(key: string): Promise<void>;
  scrollDown(amount?: number): Promise<void>;
  scrollUp(amount?: number): Promise<void>;
  screenshot(): Promise<string>;
  navigate(url: string): Promise<void>;
  listTabs(): Promise<TabInfo[]>;
  /** Re-targets every later action at this tab and brings it to the front. */
  switchTab(tabId: TabId): Promise<TabInfo>;
}

/**
 * `onSwitch` fires when the agent re-targets itself mid-run — the background
 * moves the on-page badge and the panel's driving chip with it.
 */
export function createDriver(
  initialTabId: TabId,
  onSwitch?: (tab: TabInfo) => void,
): BrowserDriver {
  // The run starts on the submit-time tab but may hop: the CDP layer is
  // multi-tab (attach re-targets per call), so the driver just tracks a target.
  let current = initialTabId;

  return {
    async snapshot(opts) {
      return captureSnapshot(current, opts);
    },

    async click(ref) {
      await ensureAttached(current);
      const rect = await resolveRefRect(current, ref);
      const cx = Math.round(rect.x + rect.width / 2);
      const cy = Math.round(rect.y + rect.height / 2);
      await clickAt(cx, cy);
      return { x: cx, y: cy };
    },

    async type(text) {
      await ensureAttached(current);
      await typeText(text);
    },

    async insert(text) {
      await ensureAttached(current);
      await insertText(text);
    },

    async key(key) {
      await ensureAttached(current);
      await pressKey(key);
    },

    async scrollDown(amount = 300) {
      await ensureAttached(current);
      await scroll(0, amount);
    },

    async scrollUp(amount = 300) {
      await ensureAttached(current);
      await scroll(0, -amount);
    },

    async screenshot() {
      await ensureAttached(current);
      return screenshot();
    },

    async navigate(url) {
      await navigateToUrl(current, url);
    },

    async listTabs() {
      const tabs = await chrome.tabs.query({});
      return tabs.flatMap((t) =>
        t.id === undefined
          ? []
          : [
              {
                id: t.id,
                windowId: t.windowId,
                title: truncate(t.title ?? "", 80),
                url: truncate(t.url ?? "", 120),
                active: t.active === true,
                ...(t.favIconUrl ? { favIconUrl: t.favIconUrl } : {}),
              },
            ],
      );
    },

    async switchTab(tabId) {
      // chrome.tabs.get throws for a dead id — the model then re-lists.
      const tab = await chrome.tabs.get(tabId);
      // Trusted input needs the tab on screen — a background tab doesn't get
      // real events. Bring it forward, the way the panel's chip does.
      await chrome.tabs.update(tabId, { active: true });
      await chrome.windows.update(tab.windowId, { focused: true });
      current = tabId;
      const info: TabInfo = {
        id: tabId,
        windowId: tab.windowId,
        title: tab.title ?? "",
        url: tab.url ?? "",
        active: true,
        ...(tab.favIconUrl ? { favIconUrl: tab.favIconUrl } : {}),
      };
      onSwitch?.(info);
      return info;
    },
  };
}
