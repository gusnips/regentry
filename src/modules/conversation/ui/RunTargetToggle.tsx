import { useTranslation } from "react-i18next";
import { useConversationStore } from "./store";
import { useWalkAway } from "./hooks";
import { Button } from "@/components/Button";
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
 * Where the run drives, as the composer card's left anchor. Two states, so a
 * click flips it — no popup for one bit of information. The current mode is the
 * label (self-explanatory); the tooltip says what the other mode does.
 *
 * Once a run of this panel's own is live the question is settled — it is
 * already on its tab, and nothing a toggle says can move it. So the control
 * becomes the one move still on the table: leave it to work alone. Disabled
 * while the plan gate is still ahead, because closing then strands the approval
 * on a notification — the tooltip says so rather than leaving a dead grey
 * button. It goes back to being a preference the moment the run ends.
 */
export function RunTargetToggle() {
  const { t } = useTranslation();
  const runTarget = useConversationStore((s) => s.runTarget);
  const setRunTarget = useConversationStore((s) => s.setRunTarget);
  const { live, ready } = useWalkAway();
  const thisPage = runTarget === "thisPage";

  if (live) {
    return (
      <Button
        type="button"
        variant="ghost"
        size="sm"
        disabled={!ready}
        // Deliberately no setRunTarget: this is an act on the run in flight,
        // not a vote on where the next one goes.
        onClick={() => window.close()}
        title={t(ready ? "run.backgroundNowTitle" : "run.backgroundNowGated")}
        className="flex shrink-0 items-center gap-1.5 hover:text-neutral-900 dark:hover:text-neutral-100"
      >
        <BackgroundIcon />
        <span className="truncate">{t("run.backgroundNow")}</span>
      </Button>
    );
  }

  const flip = () => setRunTarget(thisPage ? "background" : "thisPage");

  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      onClick={flip}
      aria-label={t("run.targetAria", {
        target: thisPage ? t("run.thisPage") : t("run.background"),
      })}
      title={t("run.targetTitle")}
      className="flex shrink-0 items-center gap-1.5 hover:text-neutral-900 dark:hover:text-neutral-100"
    >
      {thisPage ? <ThisPageIcon /> : <BackgroundIcon />}
      <span className="truncate">{thisPage ? t("run.thisPage") : t("run.background")}</span>
    </Button>
  );
}
