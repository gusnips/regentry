import type { TabId } from "@/shared/types";
import { createLogger } from "@/lib/logger";

const log = createLogger("indicator");
const HOST_ID = "regent-agent-indicator";

/**
 * On-page badge marking the tab an agent is driving.
 *
 * Without it the only signal that something else is typing into your browser
 * lives in a side panel you may have scrolled away from — the tab itself looks
 * possessed. Every comparable extension shows one.
 *
 * Best-effort by design: restricted pages (chrome://, the Web Store) reject
 * injection, and a run must not fail because its badge could not be drawn.
 */

/** Set while a run owns a tab, so a navigation can restore the badge it wiped. */
let activeLabel: string | null = null;

/** Runs in the page. Must be fully self-contained — it is serialized, not closed over. */
function paintBadge(hostId: string, label: string): void {
  document.getElementById(hostId)?.remove();

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

  // documentElement covers the window between parse start and <body>.
  (document.body ?? document.documentElement).appendChild(host);
}

/** Runs in the page. */
function removeBadge(hostId: string): void {
  document.getElementById(hostId)?.remove();
}

async function inject(
  tabId: TabId,
  func: (...args: string[]) => void,
  args: string[],
): Promise<void> {
  try {
    await chrome.scripting.executeScript({ target: { tabId }, func, args });
  } catch (e) {
    log.debug("badge injection skipped:", e instanceof Error ? e.message : String(e));
  }
}

export async function showAgentIndicator(tabId: TabId, label: string): Promise<void> {
  activeLabel = label;
  await inject(tabId, paintBadge, [HOST_ID, label]);
}

/** Repaint after a navigation wiped the document. No-op when no run is active. */
export async function refreshAgentIndicator(tabId: TabId): Promise<void> {
  if (activeLabel) await inject(tabId, paintBadge, [HOST_ID, activeLabel]);
}

export async function hideAgentIndicator(tabId: TabId): Promise<void> {
  activeLabel = null;
  await inject(tabId, removeBadge, [HOST_ID]);
}
