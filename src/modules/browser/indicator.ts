import type { TabId } from "@/shared/types";
import { createLogger } from "@/lib/logger";
import { i18n } from "@/i18n";
import { WIDGET_HOST_ID } from "./status-widget";

const log = createLogger("indicator");
const HOST_ID = "tabrunner-agent-indicator";
const FAVICON_LINK_ID = "tabrunner-agent-favicon";
/** The link that hands the favicon back to the page when the run lets go. */
const RESTORE_LINK_ID = "tabrunner-agent-favicon-restore";
/** Every mark we inject into a page — what a coordinate click must see through. */
const MARK_HOST_IDS = [HOST_ID, WIDGET_HOST_ID];

/**
 * Driving marks on the tab an agent is driving — two halves, one lifecycle:
 *
 * - an on-page badge, because the only other signal lives in a side panel you
 *   may have scrolled away from, and a tab typing by itself looks possessed.
 *   Clicking it opens the panel — the mark you can see is the way back to the
 *   run, which matters most in the waiting state, where answering IS the next
 *   step. That costs a guard: the agent clicks by viewport coordinate, so a
 *   badge that swallowed a click in the top-right would break its own run.
 *   `withMarksClickThrough` makes every mark inert around each click;
 * - an amber dot over the tab's favicon, because once the user switches to
 *   another tab the badge is invisible and the strip is all they have left.
 *   A still dot, not a blink: motion in a 16px favicon reads as a broken page.
 *
 * One tab per run, and runs move one at a time (switch_tab hides before it
 * shows), so at most one tab per run is marked. Marks are repainted after any
 * load that wipes them, including click-triggered navigations.
 *
 * The favicon dot breathes — a heartbeat saying "working", not just "here".
 * The frames are pushed from this worker, never by a page-side timer: Chrome
 * throttles hidden-tab timers into silence, and hidden is exactly when the
 * strip signal matters. The worker stays awake for the run (the panel's Port
 * heartbeat sees to that).
 *
 * When a run parks on the user (a plan to approve, an ask_user question), the
 * dot does not vanish — that is the moment the agent needs you most. It settles
 * into a still amber "?": working became waiting-on-you. Still, not pulsing —
 * the pulse is the "alive" language, and the agent is now blocked on the human.
 * The badge stays too, saying so and offering the way back; it used to be
 * pulled here, which meant a run that re-planned mid-flight silently stripped
 * the page of every sign TabRunner was on it. The wait clears when the next run
 * starts (an answer is a run) or the tab is otherwise unmarked.
 *
 * Best-effort by design: restricted pages (chrome://, the Web Store), a PDF
 * viewer, a `file://` url without file access and a hostile CSP all reject
 * injection, and a run must not fail because its marks could not be drawn.
 * That is survivable only because it is not the last line: the run's green tab
 * group and the toolbar badge (action-badge.ts) need no injection at all.
 */

/**
 * Tabs currently bearing the marks — one per live run; concurrent runs in
 * different windows each keep theirs. Refresh and hide consult this set, so
 * one run ending never blanks another run's marks.
 */
const markedTabs = new Set<TabId>();
/**
 * The tab whose run is blocked on the user — a plan waiting for a yes, or a
 * question it ended on. Its marks carry the still "?" until the answer comes,
 * and a repaint after a navigation must land the waiting state, not "driving".
 * One conversation drives at a time, so one wait at a time is enough (a second
 * panel's question would overwrite this tracking, not the first tab's mark).
 */
let waitingTabId: TabId | null = null;

/** Solid amber dot — the favicon the driven tab shows in the tab strip. */
const FAVICON_DATA_URL =
  "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16'%3E%3Ccircle cx='8' cy='8' r='6' fill='%23fbbf24'/%3E%3C/svg%3E";
/** The same dot at a quarter opacity — the heartbeat's low beat. */
const FAVICON_DIM_URL =
  "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16'%3E%3Ccircle cx='8' cy='8' r='6' fill='%23fbbf24' fill-opacity='0.25'/%3E%3C/svg%3E";
/** The dot with a knocked-out "?" — the run ended on a question for the user. */
const FAVICON_WAITING_URL =
  "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16'%3E%3Ccircle cx='8' cy='8' r='6' fill='%23fbbf24'/%3E%3Ctext x='8' y='11.3' font-size='9.5' font-weight='700' text-anchor='middle' fill='%23451a03' font-family='ui-sans-serif,system-ui,sans-serif'%3E%3F%3C/text%3E%3C/svg%3E";
const FAVICON_FRAMES = [FAVICON_DATA_URL, FAVICON_DIM_URL];
/** Two beats make the badge's 1.4s breath — one motion language for "alive". */
const PULSE_BEAT_MS = 700;
/** One heartbeat per driven tab; started on show, stopped on hide. */
const pulseTimers = new Map<TabId, ReturnType<typeof setInterval>>();

/**
 * Runs in the page. Must be fully self-contained — it is serialized, not closed over.
 * The favicon link is appended last, so it wins over the page's own; a page that
 * manages its favicon dynamically (unread counters) can still out-vote it mid-run —
 * we don't fight the page, the badge keeps carrying the signal.
 *
 * scripts/shoot-store.ts hand-mirrors this markup for store screenshots —
 * change one, change both.
 *
 * `waiting` swaps the pulsing dot for the still "?" the favicon and the pill
 * speak: the run is alive but blocked on the user, and motion would be a lie.
 */
export function paintIndicator(
  hostId: string,
  label: string,
  hint: string,
  linkId: string,
  faviconUrl: string,
  restoreId: string,
  waiting: boolean,
): void {
  document.getElementById(hostId)?.remove();
  document.getElementById(linkId)?.remove();
  document.getElementById(restoreId)?.remove();

  const host = document.createElement("div");
  host.id = hostId;
  // The host stays click-through; only the badge itself takes pointer events,
  // so the corner around it is the page's. `data-inert` gives that back for the
  // length of an agent click — see withMarksClickThrough. All of it goes in
  // with priority: the host lives in page CSS space, where an author
  // `!important` rule could otherwise pin, move, or click-block the mark.
  host.style.setProperty("position", "fixed", "important");
  host.style.setProperty("top", "12px", "important");
  host.style.setProperty("right", "12px", "important");
  host.style.setProperty("z-index", "2147483647", "important");
  host.style.setProperty("pointer-events", "none", "important");

  // Closed shadow root — page CSS cannot restyle the badge and page scripts
  // cannot reach in to hide it.
  const root = host.attachShadow({ mode: "closed" });
  const style = document.createElement("style");
  /* Hexes mirror theme.css tokens (a page function can't import them):
     #0b1224 = neutral-900, #e8eefb = neutral-100, #34d399 = brand-400,
     #fbbf24 = amber-400, #451a03 = amber-950. Recolor both sides together. */
  style.textContent = `
    .badge {
      display: flex; align-items: center; gap: 6px;
      padding: 6px 10px; border-radius: 9999px;
      border: 0; background: #0b1224ee; color: #e8eefb;
      font: 500 12px/1.2 ui-sans-serif, system-ui, sans-serif;
      /* The resting ring keeps the near-black pill an object on dark pages —
         the shadow alone vanishes there. */
      box-shadow: 0 2px 12px #0000004d, 0 0 0 1px #34d39966;
      pointer-events: auto; cursor: pointer;
    }
    .badge:hover { background: #0b1224; }
    :host([data-inert]) .badge { pointer-events: none }
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
  `;

  // A button, not a div: the mark is the way back to the run, so it answers to
  // Enter and to a screen reader as the control it is.
  const badge = document.createElement("button");
  badge.className = "badge";
  badge.type = "button";
  badge.title = hint;
  badge.addEventListener("click", () => {
    void chrome.runtime.sendMessage({ type: "tabrunner-mark", action: "open" });
  });
  // The status glyph is decorative — the badge's name is its label text, and a
  // leading "?" must never be what a screen reader announces.
  const dot = document.createElement("span");
  dot.setAttribute("aria-hidden", "true");
  if (waiting) {
    dot.className = "wait";
    dot.textContent = "?";
  } else {
    dot.className = "dot";
  }
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

/**
 * Runs in the page: one heartbeat frame. Reduced motion holds the full frame —
 * checked per beat so a live preference change takes effect without a re-run.
 * A no-op between a navigation wiping the link and the repaint restoring it.
 */
export function stepFaviconFrame(linkId: string, frameUrl: string): void {
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  const link = document.getElementById(linkId);
  if (link instanceof HTMLLinkElement) link.href = frameUrl;
}

/**
 * Runs in the page: hand the corner back for the length of one agent click.
 * Toggling an attribute on the host beats reaching for the badge itself — the
 * shadow root is closed, so the CSS inside it is the only way in.
 */
export function setMarksInert(hostIds: string[], inert: boolean): void {
  for (const id of hostIds) {
    const host = document.getElementById(id);
    if (!host) continue;
    if (inert) host.dataset.inert = "1";
    else delete host.dataset.inert;
  }
}

/**
 * Run a coordinate click with our marks click-through, so a badge sitting over
 * the element the agent aimed at can never eat the click (and open the panel
 * mid-run, which would move a screen a background run promised not to touch).
 * Awaited on both sides: back-to-back clicks must not restore one while the
 * next is dispatching. Best-effort like every injection — a page that refuses
 * the toggle has no marks to swallow anything either.
 */
export async function withMarksClickThrough<T>(tabId: TabId, act: () => Promise<T>): Promise<T> {
  await inject(tabId, setMarksInert, [MARK_HOST_IDS, true]);
  try {
    return await act();
  } finally {
    await inject(tabId, setMarksInert, [MARK_HOST_IDS, false]);
  }
}

function startPulse(tabId: TabId): void {
  stopPulse(tabId);
  let frame = 0;
  pulseTimers.set(
    tabId,
    setInterval(() => {
      frame = 1 - frame;
      void inject(tabId, stepFaviconFrame, [
        FAVICON_LINK_ID,
        FAVICON_FRAMES[frame] ?? FAVICON_DATA_URL,
      ]);
    }, PULSE_BEAT_MS),
  );
}

function stopPulse(tabId: TabId): void {
  const timer = pulseTimers.get(tabId);
  if (timer !== undefined) clearInterval(timer);
  pulseTimers.delete(tabId);
}

/** False when the page refused the script — the caller decides what that costs. */
async function inject<A extends unknown[]>(
  tabId: TabId,
  func: (...args: A) => void,
  args: A,
): Promise<boolean> {
  try {
    await chrome.scripting.executeScript({ target: { tabId }, func, args });
    return true;
  } catch (e) {
    log.debug("indicator injection skipped:", e instanceof Error ? e.message : String(e));
    return false;
  }
}

/**
 * A page that refuses the paint refuses every heartbeat frame too — a PDF
 * viewer, a `file://` url without file access, a CSP that blocks injection. So
 * the pulse only starts once the badge is actually on the page; otherwise the
 * run would spend an `executeScript` every 700ms, forever, drawing nothing. The
 * marks stay tracked either way: a navigation onto a page that does accept them
 * repaints through refreshAgentIndicator, which picks the heartbeat back up.
 *
 * Losing the marks is a degradation, not a dead end — the run's green tab group
 * and the toolbar badge (action-badge.ts) carry the signal on any page.
 */
async function paintMarks(tabId: TabId, waiting: boolean): Promise<void> {
  const painted = await inject(tabId, paintIndicator, [
    HOST_ID,
    i18n.t(waiting ? "indicator.waiting" : "indicator.driving"),
    i18n.t("indicator.open"),
    FAVICON_LINK_ID,
    waiting ? FAVICON_WAITING_URL : FAVICON_DATA_URL,
    RESTORE_LINK_ID,
    waiting,
  ]);
  // A still state has nothing to beat; a refused paint would beat at nothing.
  if (painted && !waiting) startPulse(tabId);
  else stopPulse(tabId);
}

export async function showAgentIndicator(tabId: TabId): Promise<void> {
  waitingTabId = null;
  markedTabs.add(tabId);
  await paintMarks(tabId, false);
}

/** Repaint after a load wiped the document. No-op unless this tab is marked. */
export async function refreshAgentIndicator(tabId: TabId): Promise<void> {
  if (!markedTabs.has(tabId)) return;
  await paintMarks(tabId, waitingTabId === tabId);
}

export async function hideAgentIndicator(tabId: TabId): Promise<void> {
  if (waitingTabId === tabId) waitingTabId = null;
  markedTabs.delete(tabId);
  stopPulse(tabId);
  await inject(tabId, removeIndicator, [HOST_ID, FAVICON_LINK_ID, RESTORE_LINK_ID]);
}

/**
 * The run is blocked on the user — a plan to approve, or a question it ended
 * on. Stop the heartbeat and settle both marks into the still "?", badge
 * included: it says what is wanted and, clicked, brings the panel back to
 * answer in. It holds until the next run starts or the tab is unmarked.
 */
export async function waitAgentIndicator(tabId: TabId): Promise<void> {
  waitingTabId = tabId;
  markedTabs.add(tabId);
  await paintMarks(tabId, true);
}

/** Forget any pending wait — called when the next run starts anywhere. */
export async function clearAgentWait(): Promise<void> {
  if (waitingTabId === null) return;
  await hideAgentIndicator(waitingTabId);
}
