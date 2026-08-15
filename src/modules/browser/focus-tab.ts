/**
 * Bring a tab forward — its window first, then the tab inside it, so the window
 * never flashes whatever tab it was last on. The one way to put a tab on screen:
 * the panel's chips and the driver's watched `switch_tab` follow land here.
 * Best-effort: a tab that died surfaces through the run itself, and a gone
 * board entry drops out on the next transition.
 *
 * `pullWindow: false` activates the tab inside its window but never raises the
 * window itself — the agent's one move (the watched switch_tab follow) must not
 * yank Chrome out of another app. A user's own click (chips, the board) keeps
 * the pull: they are right there, asking to see the tab.
 */
export async function focusTab(
  tabId: number,
  windowId?: number,
  opts: { pullWindow?: boolean } = {},
): Promise<void> {
  try {
    const win = windowId ?? (await chrome.tabs.get(tabId)).windowId;
    if (win !== undefined && opts.pullWindow !== false) {
      await chrome.windows.update(win, { focused: true });
    }
    await chrome.tabs.update(tabId, { active: true });
  } catch {
    // The tab is gone — nothing sensible to focus instead.
  }
}
