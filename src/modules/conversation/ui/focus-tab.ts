/**
 * Bring a tab forward — its window first, then the tab inside it. Best-effort:
 * a tab that died mid-run surfaces through the run itself, and a gone board
 * entry drops out on the next transition.
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
