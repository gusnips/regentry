import { createLogger } from "@/lib/logger";
import { isRestrictedUrl } from "./restricted-url";

const log = createLogger("widget");
const HOST_ID = "tabrunner-status-widget";

/**
 * The floating run-status widget — a small pill injected into each window's
 * ACTIVE tab while TabRunner has work (a run in flight or a queue waiting), so
 * "dispatch and forget" is never "dispatch and wonder". The indicator badges
 * the one tab being driven (which the widget always skips); this is the ambient
 * signal on whatever the user is actually looking at.
 *
 * Mirrors indicator.ts: a serialized, self-contained page function, a closed
 * shadow root the page cannot restyle or reach into, best-effort injection
 * (restricted pages reject it and must never matter), and repaint-on-load
 * because every navigation wipes the document.
 *
 * Unlike the indicator this one is clickable — it is the way back to the run —
 * so pointer-events stay on, confined to the pill. Its two buttons message the
 * worker ("open" the side panel, "hide" the widget); the isolated world that
 * executeScript runs in has extension API access.
 */

/** What one paint needs — pre-digested by the worker (i18n, excerpts). */
export interface WidgetState {
  /** The running task's excerpt. */
  task: string;
  /** "+N queued" chip text — empty when nothing waits. */
  queuedText: string;
  /** Parked on the user's answer — the pulse becomes a still "?". */
  awaiting: boolean;
  openLabel: string;
  hideLabel: string;
  /** Button tooltips — hide's says the choice is permanent until Settings. */
  openHint: string;
  hideHint: string;
}

/** Tabs currently showing the pill — repaint and removal consult this set. */
const widgetTabs = new Set<number>();
/** The last sync's inputs — activation churn reconciles against them. */
let lastState: WidgetState | null = null;
let lastExclude: number | undefined;

/**
 * Runs in the page. Must be fully self-contained — it is serialized, not closed
 * over. The buttons post their intent to the worker; the page function never
 * sees the answer, the pill just repaints or vanishes on the next sync.
 */
export function paintWidget(
  hostId: string,
  task: string,
  queuedText: string,
  openLabel: string,
  hideLabel: string,
  openHint: string,
  hideHint: string,
  awaiting: boolean,
): void {
  document.getElementById(hostId)?.remove();

  const host = document.createElement("div");
  host.id = hostId;
  host.style.cssText =
    "position:fixed;bottom:12px;right:12px;z-index:2147483647;font-family:ui-sans-serif,system-ui,sans-serif";

  const root = host.attachShadow({ mode: "closed" });
  const style = document.createElement("style");
  style.textContent = `
    .pill {
      display: flex; align-items: center; gap: 8px;
      max-width: calc(100vw - 24px);
      padding: 6px 8px 6px 10px; border-radius: 9999px;
      background: #2e1065ee; color: #ede9fe;
      font: 500 12px/1.2 ui-sans-serif, system-ui, sans-serif;
      box-shadow: 0 2px 12px #0000004d;
    }
    .dot {
      width: 6px; height: 6px; border-radius: 9999px; flex: none;
      background: #a78bfa; animation: pulse 1.4s ease-in-out infinite;
    }
    .wait {
      width: 14px; height: 14px; border-radius: 9999px; flex: none;
      display: flex; align-items: center; justify-content: center;
      background: #a78bfa; color: #2e1065; font-size: 10px; font-weight: 700;
    }
    @keyframes pulse { 0%, 100% { opacity: 1 } 50% { opacity: .25 } }
    @media (prefers-reduced-motion: reduce) { .dot { animation: none } }
    .brand { flex: none; color: #c4b5fd; }
    .task { max-width: 220px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .queued {
      flex: none; padding: 1px 6px; border-radius: 9999px;
      background: #a78bfa33; font-size: 11px;
    }
    .btn {
      flex: none; border: 0; border-radius: 9999px; padding: 3px 8px;
      background: transparent; color: #c4b5fd; font: inherit; cursor: pointer;
    }
    .btn:hover { background: #a78bfa33; color: #ede9fe; }
  `;

  const pill = document.createElement("div");
  pill.className = "pill";
  // Parked on an answer speaks the favicon's wait language: a still "?", never
  // the pulse — motion is the "working" signal and the run is blocked on you.
  const dot = document.createElement("span");
  if (awaiting) {
    dot.className = "wait";
    dot.textContent = "?";
  } else {
    dot.className = "dot";
  }
  // Self-identifying on unrelated pages — the badge's own purple language.
  const brand = document.createElement("span");
  brand.className = "brand";
  brand.textContent = "TabRunner ·";
  const text = document.createElement("span");
  text.className = "task";
  text.textContent = task;
  text.title = task;
  pill.append(dot, brand, text);
  if (queuedText) {
    const queued = document.createElement("span");
    queued.className = "queued";
    queued.textContent = queuedText;
    pill.appendChild(queued);
  }
  const open = document.createElement("button");
  open.className = "btn";
  open.type = "button";
  open.textContent = openLabel;
  open.title = openHint;
  open.addEventListener("click", () => {
    void chrome.runtime.sendMessage({ type: "tabrunner-widget", action: "open" });
  });
  const hide = document.createElement("button");
  hide.className = "btn";
  hide.type = "button";
  hide.textContent = hideLabel;
  hide.title = hideHint;
  hide.addEventListener("click", () => {
    void chrome.runtime.sendMessage({ type: "tabrunner-widget", action: "hide" });
  });
  pill.append(open, hide);
  root.append(style, pill);
  (document.body ?? document.documentElement).appendChild(host);
}

/** Runs in the page. */
export function removeWidget(hostId: string): void {
  document.getElementById(hostId)?.remove();
}

function argsOf(state: WidgetState): Parameters<typeof paintWidget> {
  return [
    HOST_ID,
    state.task,
    state.queuedText,
    state.openLabel,
    state.hideLabel,
    state.openHint,
    state.hideHint,
    state.awaiting,
  ];
}

async function inject<A extends unknown[]>(
  tabId: number,
  func: (...args: A) => void,
  args: A,
): Promise<void> {
  try {
    await chrome.scripting.executeScript({ target: { tabId }, func, args });
  } catch (e) {
    log.debug("widget injection skipped:", e instanceof Error ? e.message : String(e));
  }
}

/** Each window's active tab, minus restricted pages and the driven tab. */
async function eligibleTabs(excludeTabId?: number): Promise<Set<number>> {
  const eligible = new Set<number>();
  let tabs: chrome.tabs.Tab[];
  try {
    tabs = await chrome.tabs.query({ active: true });
  } catch {
    return eligible;
  }
  for (const tab of tabs) {
    if (tab.id === undefined || tab.id === excludeTabId || isRestrictedUrl(tab.url)) continue;
    eligible.add(tab.id);
  }
  return eligible;
}

/** Drop the pill from tracked tabs that fell out of the eligible set. */
async function removeFrom(ineligible: number[]): Promise<void> {
  await Promise.all(
    ineligible.map((tabId) => {
      widgetTabs.delete(tabId);
      return inject(tabId, removeWidget, [HOST_ID]);
    }),
  );
}

async function removeEverywhere(): Promise<void> {
  const tabs = [...widgetTabs];
  widgetTabs.clear();
  await Promise.all(tabs.map((tabId) => inject(tabId, removeWidget, [HOST_ID])));
}

/**
 * Paint the pill on each window's active tab (never the driven tab), or remove
 * it everywhere when there is nothing to report (or the user hid it — the
 * caller passes null then). Repaints every tracked tab: the content may have
 * changed with the board.
 */
export async function syncStatusWidget(
  state: WidgetState | null,
  excludeTabId?: number,
): Promise<void> {
  lastState = state;
  lastExclude = excludeTabId;
  if (!state) {
    await removeEverywhere();
    return;
  }
  const eligible = await eligibleTabs(excludeTabId);
  await removeFrom([...widgetTabs].filter((id) => !eligible.has(id)));
  const args = argsOf(state);
  await Promise.all(
    [...eligible].map((tabId) => {
      widgetTabs.add(tabId);
      return inject(tabId, paintWidget, args);
    }),
  );
}

/**
 * Activation/focus churn against the last sync: paint the newly active, pull
 * the pill from tabs that lost activation. No content re-digest — the board
 * drives that through syncStatusWidget.
 */
export async function reconcileStatusWidgets(): Promise<void> {
  if (!lastState) return;
  const eligible = await eligibleTabs(lastExclude);
  await removeFrom([...widgetTabs].filter((id) => !eligible.has(id)));
  const fresh = [...eligible].filter((id) => !widgetTabs.has(id));
  const args = argsOf(lastState);
  await Promise.all(
    fresh.map((tabId) => {
      widgetTabs.add(tabId);
      return inject(tabId, paintWidget, args);
    }),
  );
}

/** Repaint after a load wiped the document. No-op unless this tab has the pill. */
export async function refreshStatusWidget(tabId: number, state: WidgetState): Promise<void> {
  if (!widgetTabs.has(tabId)) return;
  await inject(tabId, paintWidget, argsOf(state));
}

/**
 * Remove the pill without knowing where it is — a restarted worker's sweep:
 * the tracking set died with the old worker, the pills did not.
 */
export async function sweepStatusWidget(): Promise<void> {
  widgetTabs.clear();
  lastState = null;
  let tabs: chrome.tabs.Tab[];
  try {
    tabs = await chrome.tabs.query({});
  } catch {
    return;
  }
  const removals: Promise<void>[] = [];
  for (const tab of tabs) {
    if (tab.id === undefined || isRestrictedUrl(tab.url)) continue;
    removals.push(inject(tab.id, removeWidget, [HOST_ID]));
  }
  await Promise.all(removals);
}
