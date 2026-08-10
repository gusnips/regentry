/**
 * The toolbar badge — the ONE run signal that never depends on injection.
 *
 * Everything else that says "TabRunner is working" is painted into a page and
 * is therefore best-effort: the driven tab's badge and favicon dot, and the
 * floating pill, all go through `chrome.scripting.executeScript`, which a
 * restricted page, a PDF viewer, a `file://` URL without file access, or a
 * hostile CSP can refuse — silently, since a run must never fail because its
 * marks could not be drawn. The pill has a second hole: the user can turn it
 * off for good (`widgetHidden`), and it deliberately skips the driven tab,
 * which under tab adoption IS the tab the user is looking at.
 *
 * So closing the panel could leave nothing on screen at all. This is the floor
 * under that: painted by the browser itself, on every page type, whatever the
 * pref says. Alongside the run's green tab group (also injection-free), it
 * means "did my task keep running?" always has an answer within a glance.
 *
 * Count, not a dot, because the number is the part no other surface carries
 * once the panel is closed — one run, or four waiting behind it. Parked on the
 * user it becomes "?", the same wait language the favicon and the pill speak.
 *
 * Pre-digested by the worker, like `WidgetState` — this module never reads the
 * board itself, so nothing under `browser/` depends on `agent/`.
 */

/** Amber = alive/working, the favicon dot's own colour; dark text for contrast. */
const BADGE_BG = "#fbbf24";
const BADGE_FG = "#451a03";

/** `count` is running + queued; 0 clears the badge. */
export async function syncActionBadge(count: number, awaiting = false): Promise<void> {
  const text = count === 0 ? "" : awaiting ? "?" : String(count);
  try {
    await chrome.action.setBadgeText({ text });
    if (text) {
      await chrome.action.setBadgeBackgroundColor({ color: BADGE_BG });
      await chrome.action.setBadgeTextColor({ color: BADGE_FG });
    }
  } catch {
    // No toolbar to paint — the tab group still names the work.
  }
}
