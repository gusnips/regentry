import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useConversationStore } from "./store";

/**
 * Header chip naming the tab the live run is driving — the panel is
 * window-scoped and stays open everywhere, so without this the run's target
 * is invisible. Lives in the header chip row, not the run card, so it never
 * hides among the plan rows; quiet on purpose, it appears when a run starts
 * and one click brings that tab to the front.
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
      className="flex min-w-0 max-w-[45%] cursor-pointer items-center gap-1.5 rounded-lg px-2 py-1 text-xs text-neutral-600 hover:bg-neutral-100 hover:text-neutral-900 focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:outline-none dark:text-neutral-300 dark:hover:bg-neutral-800 dark:hover:text-neutral-100"
    >
      {/* The run card's live dot, smaller — ties the chip to the run without a loud band. */}
      <span aria-hidden className="h-1.5 w-1.5 shrink-0 rounded-full bg-brand-500" />
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
