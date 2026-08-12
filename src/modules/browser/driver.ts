import { captureSnapshot, resolveRefRect } from "./snapshot";
import type { SnapshotOptions, SnapshotResult } from "./snapshot";
import { fillField } from "./fill";
import { sanitizeForModel } from "./sanitize";
import { listRequests, listConsoleMessages } from "./inspect";
import type { RequestEntry, ConsoleEntry } from "./inspect";
import {
  clickAt,
  typeText,
  insertText,
  pressKey,
  scroll,
  screenshot,
  evaluateRaw,
  navigateToUrl,
  ensureAttached,
} from "./cdp-driver";
import { focusTab } from "./focus-tab";
import { i18n } from "@/i18n";
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
  /**
   * Set a field's value page-side (native setter + input/change) — the fallback
   * for when trusted keystrokes don't land. Runs via scripting, no debugger.
   */
  fill(ref: string, text: string): Promise<void>;
  /**
   * Run JS in the page's main world (CDP — CSP-exempt, promises awaited) and
   * hand back the sanitized, bounded result. Needs the debugger.
   */
  evaluate(expression: string): Promise<unknown>;
  /** The tab's network log since attach — method, url, status, failure; no bodies. */
  readNetworkRequests(
    urlFilter?: string,
    limit?: number,
  ): Promise<{ requests: RequestEntry[]; total: number; note?: string }>;
  /** The tab's console output and uncaught exceptions since attach. */
  readConsoleMessages(
    onlyErrors?: boolean,
    limit?: number,
  ): Promise<{ messages: ConsoleEntry[]; total: number; note?: string }>;
  key(key: string): Promise<void>;
  scrollDown(amount?: number): Promise<void>;
  scrollUp(amount?: number): Promise<void>;
  screenshot(): Promise<string>;
  navigate(url: string): Promise<void>;
  listTabs(): Promise<TabInfo[]>;
  /** Re-targets every later action at this tab — foregrounding it is `activateOnSwitch`'s call. */
  switchTab(tabId: TabId): Promise<TabInfo>;
  /**
   * Files another open tab into the run's task group. Chrome constraint: groups
   * are window-scoped, so a tab in another window can't join — moving it across
   * windows would rip it out of the user's screen setup, which is theirs to do.
   */
  groupTab(tabId: TabId, groupId: number): Promise<TabInfo>;
}

export interface DriverOptions {
  /**
   * Fires when the agent re-targets itself mid-run — the background moves the
   * on-page badge and the panel's driving chip with it.
   */
  onSwitch?: (tab: TabInfo) => void;
  /**
   * Bring a switched-to tab to the front. On for a run that already owns the
   * screen (this-page, adopted, MCP direct control), off for a run that opened
   * its own tab — that one shows you its tab once, at the start, and after that
   * yanking your window mid-switch is exactly what "background" promises not to
   * do; CDP input reaches an inactive tab either way. The cost is that a
   * background tab gets no rAF ticks, so a page whose UI only advances on
   * animation frames can stall — a reason to pick "this page" for one, not to
   * steal focus for all.
   */
  activateOnSwitch?: boolean;
}

/** One open tab, shaped for the model — undefined for the id-less records a query can return. */
function toTabInfo(t: chrome.tabs.Tab): TabInfo | undefined {
  if (t.id === undefined) return undefined;
  return {
    id: t.id,
    windowId: t.windowId,
    title: truncate(t.title ?? "", 80),
    url: truncate(t.url ?? "", 120),
    active: t.active === true,
    ...(t.favIconUrl ? { favIconUrl: t.favIconUrl } : {}),
  };
}

export function createDriver(initialTabId: TabId, opts: DriverOptions = {}): BrowserDriver {
  const { onSwitch, activateOnSwitch = true } = opts;
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

    async fill(ref, text) {
      // Page-side by design: no debugger, no infobar — the same mechanism the
      // snapshot uses, aimed at one element.
      await fillField(current, ref, text);
    },

    async evaluate(expression) {
      await ensureAttached(current);
      return sanitizeForModel(await evaluateRaw(expression));
    },

    async readNetworkRequests(urlFilter, limit) {
      // Attach first so the capture is live even on a run that has only read.
      await ensureAttached(current);
      return listRequests(current, urlFilter, limit);
    },

    async readConsoleMessages(onlyErrors, limit) {
      await ensureAttached(current);
      return listConsoleMessages(current, onlyErrors, limit);
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
      return tabs.flatMap((t) => toTabInfo(t) ?? []);
    },

    async groupTab(tabId, groupId) {
      // Both throws land as tool errors the model can act on: a dead tab id
      // means re-list, a dead group means the run's strip is gone.
      const [tab, group] = await Promise.all([
        chrome.tabs.get(tabId),
        chrome.tabGroups.get(groupId),
      ]);
      if (tab.windowId !== group.windowId) {
        throw new Error(i18n.t("errors.tabGroupOtherWindow"));
      }
      await chrome.tabs.group({ tabIds: tabId, groupId });
      const info = toTabInfo(tab);
      if (!info) throw new Error(i18n.t("errors.noActiveTab"));
      return info;
    },

    async switchTab(tabId) {
      // chrome.tabs.get throws for a dead id — the model then re-lists.
      const tab = await chrome.tabs.get(tabId);
      // Bring it forward, the way the panel's chip does.
      if (activateOnSwitch) await focusTab(tabId, tab.windowId);
      current = tabId;
      const info: TabInfo = {
        id: tabId,
        windowId: tab.windowId,
        title: tab.title ?? "",
        url: tab.url ?? "",
        active: activateOnSwitch ? true : tab.active === true,
        ...(tab.favIconUrl ? { favIconUrl: tab.favIconUrl } : {}),
      };
      onSwitch?.(info);
      return info;
    },
  };
}
