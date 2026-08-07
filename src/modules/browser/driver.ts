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
import type { TabId } from "@/shared/types";

/**
 * Driver — single interface over snapshot (scripting) + actions (CDP).
 * Exists because the two halves use different mechanisms with different failure modes.
 * This is also the test seam.
 */

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
}

export function createDriver(tabId: TabId): BrowserDriver {
  return {
    async snapshot(opts) {
      return captureSnapshot(tabId, opts);
    },

    async click(ref) {
      await ensureAttached(tabId);
      const rect = await resolveRefRect(tabId, ref);
      const cx = Math.round(rect.x + rect.width / 2);
      const cy = Math.round(rect.y + rect.height / 2);
      await clickAt(cx, cy);
      return { x: cx, y: cy };
    },

    async type(text) {
      await ensureAttached(tabId);
      await typeText(text);
    },

    async insert(text) {
      await ensureAttached(tabId);
      await insertText(text);
    },

    async key(key) {
      await ensureAttached(tabId);
      await pressKey(key);
    },

    async scrollDown(amount = 300) {
      await ensureAttached(tabId);
      await scroll(0, amount);
    },

    async scrollUp(amount = 300) {
      await ensureAttached(tabId);
      await scroll(0, -amount);
    },

    async screenshot() {
      await ensureAttached(tabId);
      return screenshot();
    },

    async navigate(url) {
      await navigateToUrl(tabId, url);
    },
  };
}
