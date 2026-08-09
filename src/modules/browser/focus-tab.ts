/**
 * Bring a tab forward — its window first, then the tab inside it, so the window
 * never flashes whatever tab it was last on. The one way to put a tab on screen:
 * the panel's chips, the driver's `switch_tab`, and a run revealing its own tab
 * all land here. Best-effort: a tab that died surfaces through the run itself,
 * and a gone board entry drops out on the next transition.
 */
export async function focusTab(tabId: number, windowId?: number): Promise<void> {
  try {
    const win = windowId ?? (await chrome.tabs.get(tabId)).windowId;
    if (win !== undefined) await chrome.windows.update(win, { focused: true });
    await chrome.tabs.update(tabId, { active: true });
  } catch {
    // The tab is gone — nothing sensible to focus instead.
  }
}
