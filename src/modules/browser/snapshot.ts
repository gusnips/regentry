import { generateSnapshot } from "./snapshot-script";
import type { SnapshotOptions, SnapshotResult } from "./snapshot-script";
import { runInPage } from "./inject";
import type { TabId } from "@/shared/types";
import { i18n } from "@/i18n";

/**
 * Injects the snapshot function into the page and returns the result.
 */
export async function captureSnapshot(
  tabId: TabId,
  opts?: SnapshotOptions,
): Promise<SnapshotResult> {
  const result = await runInPage(tabId, generateSnapshot, [opts ?? {}]);
  if (!result) {
    throw new Error(i18n.t("errors.snapshotFailed"));
  }
  return result;
}

/**
 * Resolves a ref (e.g. "e12") to its bounding rect center via executeScript.
 * Used by cdp-driver for click-by-ref.
 */
export async function resolveRefRect(
  tabId: TabId,
  ref: string,
): Promise<{ x: number; y: number; width: number; height: number }> {
  const result = await runInPage(
    tabId,
    (refId: string) => {
      const w = window as unknown as { __tabrunnerRefs?: Map<string, WeakRef<HTMLElement>> };
      const entry = w.__tabrunnerRefs?.get(refId);
      const el = entry?.deref();
      if (!el) return null;
      el.scrollIntoView({ block: "center", inline: "center" });
      const r = el.getBoundingClientRect();
      return { x: r.x, y: r.y, width: r.width, height: r.height };
    },
    [ref],
  );

  if (!result) {
    throw new Error(i18n.t("errors.refNotFound", { ref }));
  }

  return result;
}

export type { SnapshotOptions, SnapshotResult };
