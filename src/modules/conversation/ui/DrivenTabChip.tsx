import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useConversationStore } from "./store";

/**
 * Chip naming the tab the live run is driving — the panel is window-scoped
 * and stays open everywhere, so without this the run's target is invisible.
 * Lives on the live band, on its own row under the verb line (run context,
 * same lifecycle as the band): squeezed between the verb and the timer it
 * truncated to a letter. No dot of its own — the band's is the live signal.
 * One click brings the tab to the front.
 */
export function DrivenTabChip() {
  const { t } = useTranslation();
  const drivingTab = useConversationStore((s) => s.drivingTab);
  // Keyed on the url, not a boolean: a re-targeted tab gets a fresh icon try
  // without an effect to reset state.
  const [failedIconUrl, setFailedIconUrl] = useState<string | null>(null);

  if (!drivingTab?.title) return null;

  const focusTab = async () => {
    try {
      await chrome.tabs.update(drivingTab.tabId, { active: true });
      await chrome.windows.update(drivingTab.windowId, { focused: true });
    } catch {
      // Tab was closed mid-run — the run itself will surface that failure.
    }
  };

  return (
    <button
      type="button"
      onClick={() => void focusTab()}
      title={t("run.drivingTabTip")}
      aria-label={t("run.drivingTabTip")}
      className="flex min-w-0 max-w-full cursor-pointer items-center gap-1.5 rounded-md px-1.5 py-0.5 text-xs text-brand-800/90 hover:bg-brand-100 hover:text-brand-950 focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:outline-none dark:text-brand-200/90 dark:hover:bg-brand-900 dark:hover:text-brand-50"
    >
      {drivingTab.favIconUrl && drivingTab.favIconUrl !== failedIconUrl && (
        <img
          src={drivingTab.favIconUrl}
          alt=""
          className="h-3.5 w-3.5 shrink-0 rounded-[3px]"
          onError={() => setFailedIconUrl(drivingTab.favIconUrl ?? null)}
        />
      )}
      <span className="truncate">{drivingTab.title}</span>
    </button>
  );
}
