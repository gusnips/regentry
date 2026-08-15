import { createLogger } from "@/lib/logger";
import { isRestrictedUrl } from "./restricted-url";

const log = createLogger("widget");
/** Shared with indicator.ts, which makes every mark inert around agent clicks. */
export const WIDGET_HOST_ID = "tabrunner-status-widget";

/**
 * The floating run-status widget — a small pill injected into each window's
 * ACTIVE tab while TabRunner has work (a run in flight or a queue waiting), so
 * "dispatch and forget" is never "dispatch and wonder". The indicator badges
 * the one tab being driven (which the widget always skips); this is the ambient
 * signal on whatever the user is actually looking at.
 *
 * The richest of the three run signals, and the most fragile: injection can be
 * refused, and the user can switch the pill off for good (`widgetHidden`).
 * Neither is a dead end — the toolbar badge (action-badge.ts) is the floor
 * beneath both, and it is never injected.
 *
 * Mirrors indicator.ts: a serialized, self-contained page function, a closed
 * shadow root the page cannot restyle or reach into, best-effort injection
 * (restricted pages reject it and must never matter), and repaint-on-load
 * because every navigation wipes the document.
 *
 * Clickable, like the driven tab's badge — it is the way back to the run — so
 * pointer-events stay on, confined to the pill. The click messages the worker
 * (the isolated world that executeScript runs in has extension API access);
 * "hide" never leaves the page — it collapses the pill to a small blinking
 * status dot, and clicking the dot brings the pill back. Collapse
 * survives repaints (host dataset) but not navigation, which wipes the document
 * anyway. Hiding the widget for good stays in Settings (`widgetHidden` pref).
 */

/** What one paint needs — pre-digested by the worker (i18n, excerpts). */
export interface WidgetState {
  /** The running task's excerpt. */
  task: string;
  /** "+N queued" chip text — empty when nothing waits. */
  queuedText: string;
  /** Parked on the user's answer — the pulse becomes a still "?". */
  awaiting: boolean;
  hideLabel: string;
  /** The pill's own tooltip — clicking anywhere on it opens the panel. */
  openHint: string;
  /** Collapse-to-dot tooltip; the dot's own tooltip is `expandHint`. */
  hideHint: string;
  expandHint: string;
}

/** Tabs currently showing the pill — repaint and removal consult this set. */
const widgetTabs = new Set<number>();
/** The last sync's inputs — activation churn reconciles against them. */
let lastState: WidgetState | null = null;
let lastExclude: number | undefined;

/**
 * Runs in the page. Must be fully self-contained — it is serialized, not closed
 * over. A click posts its intent to the worker and never sees the answer — the
 * side panel simply opens. "Hide" is purely local: it collapses the pill to the
 * status dot, and the dot expands back. The collapsed flag lives on the host's
 * dataset so a repaint (fresh board content re-injects this function) keeps it.
 *
 * scripts/shoot-store.ts hand-mirrors this markup for store screenshots —
 * change one, change both.
 */
export function paintWidget(
  hostId: string,
  task: string,
  queuedText: string,
  hideLabel: string,
  openHint: string,
  hideHint: string,
  expandHint: string,
  awaiting: boolean,
): void {
  const old = document.getElementById(hostId);
  // A repaint that changes nothing must not wipe the pill: rebuilding the host
  // drops in-pill focus and hover mid-gesture. The painted inputs sign the
  // host; an identical repaint leaves the DOM (and its collapsed flag) alone.
  const signature = JSON.stringify([
    task,
    queuedText,
    hideLabel,
    openHint,
    hideHint,
    expandHint,
    awaiting,
  ]);
  if (old?.dataset.signature === signature) return;
  const wasCollapsed = old?.dataset.collapsed === "1";
  old?.remove();

  const host = document.createElement("div");
  host.id = hostId;
  host.dataset.signature = signature;
  // The host lives in page CSS space — an author `!important` rule (or a
  // cosmetic filter) could demote or hide it. The critical box properties go
  // in with priority; the closed shadow root already protects everything inside.
  host.style.setProperty("position", "fixed", "important");
  host.style.setProperty("bottom", "12px", "important");
  host.style.setProperty("right", "12px", "important");
  host.style.setProperty("z-index", "2147483647", "important");
  host.style.fontFamily = "ui-sans-serif,system-ui,sans-serif";

  const root = host.attachShadow({ mode: "closed" });
  const style = document.createElement("style");
  /* Hexes are runtime copies of theme.css tokens (a page function can't import
     them): #0b1224 = neutral-900, #e8eefb = neutral-100, #6ee7b7 = brand-300,
     #34d399 = brand-400, #fbbf24 = amber-400, #fcd34d = amber-300,
     #451a03 = amber-950. A brand pass recolors here too. */
  style.textContent = `
    .pill {
      display: flex; align-items: center;
      max-width: calc(100vw - 24px);
      padding: 6px 8px 6px 10px; border-radius: 9999px;
      background: #0b1224ee; color: #e8eefb;
      font: 500 12px/1.2 ui-sans-serif, system-ui, sans-serif;
      /* The dark shadow alone dissolved into dark pages — the mini's resting
         emerald ring is what keeps the silhouette an object. */
      box-shadow: 0 2px 12px #0000004d, 0 0 0 1px #34d39966;
    }
    .pill:has(.open:hover), .pill:has(.open:focus-visible) { background: #0b1224; }
    /* The pill's content IS the open control — a transparent button filling it,
       so the whole thing reads as one target and still answers to the keyboard.
       A sibling of Hide, never its parent: nested buttons are not a thing. */
    .open {
      display: flex; align-items: center; gap: 8px; min-width: 0;
      border: 0; background: transparent; color: inherit; font: inherit;
      padding: 0; cursor: pointer;
    }
    .open:focus-visible { outline: 2px solid #6ee7b7; outline-offset: 2px; border-radius: 9999px; }
    /* Set around an agent click — see withMarksClickThrough in indicator.ts.
       The pill skips the driven tab, so this only ever covers the moment a
       switch_tab leaves one behind on a tab the run is now driving. */
    :host([data-inert]) .pill, :host([data-inert]) .mini { pointer-events: none }
    .dot {
      width: 6px; height: 6px; border-radius: 9999px; flex: none;
      background: #fbbf24; animation: pulse 1.4s ease-in-out infinite;
    }
    .wait {
      width: 14px; height: 14px; border-radius: 9999px; flex: none;
      display: flex; align-items: center; justify-content: center;
      background: #fbbf24; color: #451a03; font-size: 10px; font-weight: 700;
    }
    @keyframes pulse { 0%, 100% { opacity: 1 } 50% { opacity: .25 } }
    @media (prefers-reduced-motion: reduce) { .dot { animation: none } }
    .brand { flex: none; color: #6ee7b7; }
    .task { max-width: 220px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .queued {
      flex: none; padding: 1px 6px; border-radius: 9999px;
      /* A count is measurement — gold, not the emerald that means motion. */
      background: #fbbf2426; color: #fcd34d; font-size: 11px;
    }
    .btn {
      flex: none; border: 0; border-radius: 9999px; padding: 5px 10px;
      background: transparent; color: #6ee7b7; font: inherit; cursor: pointer;
    }
    .btn:hover { background: #34d39933; color: #e8eefb; }
    .mini {
      display: flex; align-items: center; justify-content: center;
      width: 28px; height: 28px; border: 0; border-radius: 9999px; padding: 0;
      background: #0b1224ee; box-shadow: 0 2px 12px #0000004d, 0 0 0 1px #34d39966; cursor: pointer;
    }
  `;

  // Parked on an answer speaks the favicon's wait language: a still "?", never
  // the pulse — motion is the "working" signal and the run is blocked on you.
  // The glyph is decorative — the buttons around it carry their own names, and
  // a bare "?" must never be what a screen reader announces.
  const makeStatus = (): HTMLSpanElement => {
    const dot = document.createElement("span");
    dot.setAttribute("aria-hidden", "true");
    if (awaiting) {
      dot.className = "wait";
      dot.textContent = "?";
    } else {
      dot.className = "dot";
    }
    return dot;
  };

  const pill = document.createElement("div");
  pill.className = "pill";
  // Everything but Hide is the way back, like the driven tab's badge — a
  // labeled "Open" button inside a clickable pill was two controls for one
  // action, and the pill is the bigger target.
  const open = document.createElement("button");
  open.className = "open";
  open.type = "button";
  open.title = openHint;
  open.setAttribute("aria-label", openHint);
  open.addEventListener("click", () => {
    void chrome.runtime.sendMessage({ type: "tabrunner-mark", action: "open" });
  });
  // Self-identifying on unrelated pages — the badge's own emerald language.
  const brand = document.createElement("span");
  brand.className = "brand";
  brand.textContent = "TabRunner ·";
  const text = document.createElement("span");
  text.className = "task";
  text.textContent = task;
  text.title = task;
  open.append(makeStatus(), brand, text);
  if (queuedText) {
    const queued = document.createElement("span");
    queued.className = "queued";
    queued.textContent = queuedText;
    open.appendChild(queued);
  }
  pill.appendChild(open);
  // Collapsed form: just the status mark in a small round button — still
  // blinking while working, and the way back to the pill.
  const mini = document.createElement("button");
  mini.className = "mini";
  mini.type = "button";
  mini.title = expandHint;
  // The name, not just the tooltip — content would win over title, and the
  // waiting glyph would announce this button as "question mark".
  mini.setAttribute("aria-label", expandHint);
  mini.appendChild(makeStatus());

  const setCollapsed = (collapsed: boolean): void => {
    host.dataset.collapsed = collapsed ? "1" : "0";
    pill.style.display = collapsed ? "none" : "";
    mini.style.display = collapsed ? "" : "none";
  };
  const hide = document.createElement("button");
  hide.className = "btn";
  hide.type = "button";
  hide.textContent = hideLabel;
  hide.title = hideHint;
  hide.addEventListener("click", () => setCollapsed(true));
  mini.addEventListener("click", () => setCollapsed(false));

  pill.append(hide);
  root.append(style, pill, mini);
  setCollapsed(wasCollapsed);
  (document.body ?? document.documentElement).appendChild(host);
}

/** Runs in the page. */
export function removeWidget(hostId: string): void {
  document.getElementById(hostId)?.remove();
}

function argsOf(state: WidgetState): Parameters<typeof paintWidget> {
  return [
    WIDGET_HOST_ID,
    state.task,
    state.queuedText,
    state.hideLabel,
    state.openHint,
    state.hideHint,
    state.expandHint,
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
      return inject(tabId, removeWidget, [WIDGET_HOST_ID]);
    }),
  );
}

async function removeEverywhere(): Promise<void> {
  const tabs = [...widgetTabs];
  widgetTabs.clear();
  await Promise.all(tabs.map((tabId) => inject(tabId, removeWidget, [WIDGET_HOST_ID])));
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
    removals.push(inject(tab.id, removeWidget, [WIDGET_HOST_ID]));
  }
  await Promise.all(removals);
}
