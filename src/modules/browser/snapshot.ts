import { generateSnapshot } from "./snapshot-script";
import type { SnapshotOptions, SnapshotResult } from "./snapshot-script";
import type { TabId } from "@/shared/types";

/**
 * Injects the snapshot function into the page and returns the result.
 * Uses executeScript({ func }) — the function is serialized and runs in page context.
 */
export async function captureSnapshot(
  tabId: TabId,
  opts?: SnapshotOptions,
): Promise<SnapshotResult> {
  let result;
  try {
    [result] = await chrome.scripting.executeScript({
      target: { tabId },
      func: generateSnapshot,
      args: [opts ?? {}],
      world: "MAIN",
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (/chrome:\/\/|Cannot access|extensions gallery|Web Store/i.test(msg)) {
      throw new Error(
        "Regent can't read this page — Chrome blocks extensions on chrome:// and Web Store pages. Navigate the tab to a regular page and resend the task.",
        { cause: e },
      );
    }
    throw e;
  }

  if (!result?.result) {
    throw new Error(
      "Snapshot failed: the page may have navigated or be a restricted URL (chrome://, Web Store).",
    );
  }

  return result.result as SnapshotResult;
}

/**
 * Resolves a ref (e.g. "e12") to its bounding rect center via executeScript.
 * Used by cdp-driver for click-by-ref.
 */
export async function resolveRefRect(
  tabId: TabId,
  ref: string,
): Promise<{ x: number; y: number; width: number; height: number }> {
  const [result] = await chrome.scripting.executeScript({
    target: { tabId },
    func: (refId: string) => {
      const w = window as unknown as { __regentRefs?: Map<string, WeakRef<HTMLElement>> };
      const entry = w.__regentRefs?.get(refId);
      const el = entry?.deref();
      if (!el) return null;
      el.scrollIntoView({ block: "center", inline: "center" });
      const r = el.getBoundingClientRect();
      return { x: r.x, y: r.y, width: r.width, height: r.height };
    },
    args: [ref],
    world: "MAIN",
  });

  if (!result?.result) {
    throw new Error(`Element ref "${ref}" not found. Run snapshot first to get fresh refs.`);
  }

  return result.result;
}

export type { SnapshotOptions, SnapshotResult };
