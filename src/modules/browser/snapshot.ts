import { generateSnapshot } from "./snapshot-script";
import type { SnapshotOptions, SnapshotResult } from "./snapshot-script";
import type { TabId } from "@/shared/types";
import { i18n } from "@/i18n";

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
    // Mid-navigation rejections are transient — the page moved under the
    // injection. Worded as retry, not as the hard stop a restricted page is.
    if (/frame was removed|No frame with id|tab was closed/i.test(msg)) {
      throw new Error(i18n.t("errors.pageNavigating"), { cause: e });
    }
    if (/chrome:\/\/|Cannot access|extensions gallery|Web Store/i.test(msg)) {
      throw new Error(i18n.t("errors.restrictedPage"), { cause: e });
    }
    throw e;
  }

  if (!result?.result) {
    throw new Error(i18n.t("errors.snapshotFailed"));
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
      const w = window as unknown as { __tabrunnerRefs?: Map<string, WeakRef<HTMLElement>> };
      const entry = w.__tabrunnerRefs?.get(refId);
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
    throw new Error(i18n.t("errors.refNotFound", { ref }));
  }

  return result.result;
}

export type { SnapshotOptions, SnapshotResult };
