import { useTranslation } from "react-i18next";
import { useConversationStore } from "./store";
import { Icon } from "@/components/Icon";

/** Two states of the same tab: panel open (you watch) or closed (you walk away). */
function BackgroundIcon() {
  return (
    <Icon>
      <rect x="8" y="3" width="13" height="13" rx="2" />
      <path d="M16 19v1a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V10a2 2 0 0 1 2-2h1" />
    </Icon>
  );
}

/** One page with an arrow into it — the run drives what you're looking at. */
function ThisPageIcon() {
  return (
    <Icon>
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <path d="M12 7v8m-3.5-3.5L12 15l3.5-3.5" />
    </Icon>
  );
}

/**
 * Where the next run drives, as the composer footer's left anchor. Two states,
 * so a click flips it — no popup for one bit of information. The current mode
 * is the label (self-explanatory, and the footer row exists anyway); the
 * tooltip says what the other mode does. The row is permanent because of this
 * control, so transient hints on the right never shift the layout.
 */
export function RunTargetToggle() {
  const { t } = useTranslation();
  const runTarget = useConversationStore((s) => s.runTarget);
  const setRunTarget = useConversationStore((s) => s.setRunTarget);
  const thisPage = runTarget === "thisPage";

  return (
    <button
      type="button"
      onClick={() => setRunTarget(thisPage ? "background" : "thisPage")}
      aria-label={t("run.targetAria", {
        target: thisPage ? t("run.thisPage") : t("run.background"),
      })}
      title={t("run.targetTitle")}
      className="flex shrink-0 items-center gap-1.5 rounded-lg px-2 py-1 text-xs text-neutral-600 hover:bg-neutral-100 hover:text-neutral-900 focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:outline-none dark:text-neutral-300 dark:hover:bg-neutral-800 dark:hover:text-neutral-100"
    >
      {thisPage ? <ThisPageIcon /> : <BackgroundIcon />}
      <span className="truncate">{thisPage ? t("run.thisPage") : t("run.background")}</span>
    </button>
  );
}
