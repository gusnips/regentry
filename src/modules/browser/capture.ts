import { i18n } from "@/i18n";
import type { TabId } from "@/shared/types";

/** A JPEG of a visible tab, with the identity of what was actually captured. */
export interface VisibleCapture {
  /** `data:image/jpeg;base64,…` — images are data URLs everywhere inside TabRunner. */
  dataUrl: string;
  tabId: TabId;
  title: string;
  url: string;
}

/**
 * What the browser is showing right now, as an image an external model can
 * read. Uses `chrome.tabs`, not CDP: no debugger attach, so an idle browser can
 * be looked at without announcing a run — and it works when no run is in flight
 * at all, which is exactly when an MCP client wants to look.
 *
 * ponytail: captureVisibleTab captures a window's *visible* tab, so a driven tab
 * sitting behind another one yields whatever is on top instead. The captured
 * tab's own id/title/url ride along, so the caller can tell what it is looking
 * at and is never misled. Upgrade path is CDP `Page.captureScreenshot` against
 * the live run's driver, which sees hidden tabs too.
 */
export async function captureVisibleTab(windowId?: number): Promise<VisibleCapture> {
  const [tab] = await chrome.tabs.query(
    windowId === undefined ? { active: true, currentWindow: true } : { active: true, windowId },
  );
  if (!tab?.id || tab.windowId === undefined) throw new Error(i18n.t("errors.noActiveTab"));
  try {
    const dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, {
      format: "jpeg",
      quality: 80,
    });
    return { dataUrl, tabId: tab.id, title: tab.title ?? "", url: tab.url ?? "" };
  } catch {
    // chrome:// and Web Store pages refuse capture the same way they refuse
    // scripting — say which page and what to do, never a raw failure.
    throw new Error(i18n.t("errors.restrictedPage"));
  }
}
