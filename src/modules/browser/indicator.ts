import type { TabId } from "@/shared/types";
import { createLogger } from "@/lib/logger";

const log = createLogger("indicator");
const HOST_ID = "regent-agent-indicator";
const FAVICON_LINK_ID = "regent-agent-favicon";
/** The link that hands the favicon back to the page when the run lets go. */
const RESTORE_LINK_ID = "regent-agent-favicon-restore";

/**
 * Driving marks on the tab an agent is driving — two halves, one lifecycle:
 *
 * - an on-page badge, because the only other signal lives in a side panel you
 *   may have scrolled away from, and a tab typing by itself looks possessed;
 * - a purple dot over the tab's favicon, because once the user switches to
 *   another tab the badge is invisible and the strip is all they have left.
 *   A still dot, not a blink: motion in a 16px favicon reads as a broken page.
 *
 * One tab per run, and runs move one at a time (switch_tab hides before it
 * shows), so at most one tab per run is marked. Marks are repainted after any
 * load that wipes them, including click-triggered navigations.
 *
 * Best-effort by design: restricted pages (chrome://, the Web Store) reject
 * injection, and a run must not fail because its marks could not be drawn.
 */

/** The label every mark carries, while any run is driving. */
let activeLabel: string | null = null;
/**
 * Tabs currently bearing the marks — one per live run; concurrent runs in
 * different windows each keep theirs. Refresh and hide consult this set, so
 * one run ending never blanks another run's marks.
 */
const markedTabs = new Set<TabId>();

/** Solid brand dot — the favicon the driven tab shows in the tab strip. */
const FAVICON_DATA_URL =
  "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16'%3E%3Ccircle cx='8' cy='8' r='6' fill='%23a78bfa'/%3E%3C/svg%3E";

/**
 * Runs in the page. Must be fully self-contained — it is serialized, not closed over.
 * The favicon link is appended last, so it wins over the page's own; a page that
 * manages its favicon dynamically (unread counters) can still out-vote it mid-run —
 * we don't fight the page, the badge keeps carrying the signal.
 */
export function paintIndicator(
  hostId: string,
  label: string,
  linkId: string,
  faviconUrl: string,
  restoreId: string,
): void {
  document.getElementById(hostId)?.remove();
  document.getElementById(linkId)?.remove();
  document.getElementById(restoreId)?.remove();

  const host = document.createElement("div");
  host.id = hostId;
  // pointer-events:none is load-bearing: the agent clicks by viewport coordinate,
  // so a badge that swallowed a click in the top-right would break its own run.
  host.style.cssText = "position:fixed;top:12px;right:12px;z-index:2147483647;pointer-events:none";

  // Closed shadow root — page CSS cannot restyle the badge and page scripts
  // cannot reach in to hide it.
  const root = host.attachShadow({ mode: "closed" });
  const style = document.createElement("style");
  style.textContent = `
    .badge {
      display: flex; align-items: center; gap: 6px;
      padding: 6px 10px; border-radius: 9999px;
      background: #2e1065ee; color: #ede9fe;
      font: 500 12px/1.2 ui-sans-serif, system-ui, sans-serif;
      box-shadow: 0 2px 12px #0000004d;
    }
    .dot {
      width: 6px; height: 6px; border-radius: 9999px;
      background: #a78bfa; animation: pulse 1.4s ease-in-out infinite;
    }
    @keyframes pulse { 0%, 100% { opacity: 1 } 50% { opacity: .25 } }
    @media (prefers-reduced-motion: reduce) { .dot { animation: none } }
  `;

  const badge = document.createElement("div");
  badge.className = "badge";
  const dot = document.createElement("span");
  dot.className = "dot";
  const text = document.createElement("span");
  text.textContent = label;
  badge.append(dot, text);
  root.append(style, badge);

  const link = document.createElement("link");
  link.id = linkId;
  link.rel = "icon";
  link.href = faviconUrl;

  // The badge must stay out of <head> — the UA stylesheet hides it and its
  // children. documentElement covers the window between parse start and <body>/<head>.
  (document.body ?? document.documentElement).appendChild(host);
  (document.head ?? document.documentElement).appendChild(link);
}

/**
 * Runs in the page. Removing our link alone is not enough: Chrome keeps showing
 * the last-set favicon until an icon link CHANGES, and the implicit /favicon.ico
 * fallback only applies at load — so the dot would linger on the strip. Re-assert
 * the page's own icon (the last one, mirroring Chrome's pick) — or the root
 * favicon.ico a fresh load would fall back to, when the page declared none.
 */
export function removeIndicator(hostId: string, linkId: string, restoreId: string): void {
  document.getElementById(hostId)?.remove();
  document.getElementById(linkId)?.remove();
  document.getElementById(restoreId)?.remove();

  const own = [...document.querySelectorAll<HTMLLinkElement>('link[rel~="icon"]')];
  const restore = document.createElement("link");
  restore.id = restoreId;
  restore.rel = "icon";
  restore.href = own.length > 0 ? (own[own.length - 1]?.href ?? "/favicon.ico") : "/favicon.ico";
  (document.head ?? document.documentElement).appendChild(restore);
}

async function inject(
  tabId: TabId,
  func: (...args: string[]) => void,
  args: string[],
): Promise<void> {
  try {
    await chrome.scripting.executeScript({ target: { tabId }, func, args });
  } catch (e) {
    log.debug("indicator injection skipped:", e instanceof Error ? e.message : String(e));
  }
}

export async function showAgentIndicator(tabId: TabId, label: string): Promise<void> {
  activeLabel = label;
  markedTabs.add(tabId);
  await inject(tabId, paintIndicator, [
    HOST_ID,
    label,
    FAVICON_LINK_ID,
    FAVICON_DATA_URL,
    RESTORE_LINK_ID,
  ]);
}

/** Repaint after a load wiped the document. No-op unless this tab is driven. */
export async function refreshAgentIndicator(tabId: TabId): Promise<void> {
  if (activeLabel && markedTabs.has(tabId)) {
    await inject(tabId, paintIndicator, [
      HOST_ID,
      activeLabel,
      FAVICON_LINK_ID,
      FAVICON_DATA_URL,
      RESTORE_LINK_ID,
    ]);
  }
}

export async function hideAgentIndicator(tabId: TabId): Promise<void> {
  markedTabs.delete(tabId);
  if (markedTabs.size === 0) activeLabel = null;
  await inject(tabId, removeIndicator, [HOST_ID, FAVICON_LINK_ID, RESTORE_LINK_ID]);
}
