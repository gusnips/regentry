import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useConversationStore } from "./store";
import { DrivenTabChip } from "./DrivenTabChip";
import { PlanMark } from "./PlanMark";
import { pendingAskId } from "./ask-gate";
import { useNow, useQueueBusy } from "./hooks";
import { TipLine } from "@/modules/tips/ui";
import { Button } from "@/components/Button";
import type { BridgeActive } from "@/shared/protocol";
import { formatDuration, formatTokens } from "@/lib/format";

export function RunStatus() {
  const { t } = useTranslation();
  const status = useConversationStore((s) => s.status);
  const runStartedAt = useConversationStore((s) => s.runStartedAt);
  const runEndedAt = useConversationStore((s) => s.runEndedAt);
  const usage = useConversationStore((s) => s.usage);
  const bridgeActive = useConversationStore((s) => s.bridgeActive);
  const drivingTab = useConversationStore((s) => s.drivingTab);
  // Selecting only the plan message (reference-stable until rewritten) keeps
  // this bar from re-rendering on every unrelated message churn mid-run.
  const plan = useConversationStore((s) => s.messages.findLast((m) => m.role === "plan"));
  // Parked states: a mid-run plan approval keeps the run open but blocked on
  // the user; an ask_user ends it with the question still open. Both speak
  // "waiting", never the working shimmer/pulse.
  const awaitingApproval = useConversationStore((s) => s.planApproval !== null);
  const awaitingAnswer = useConversationStore(
    (s) => pendingAskId(s.messages, s.status) !== undefined,
  );
  // A crowded footer (queued lines, a queued run, a stop-redirect in transit)
  // evicts the band's tip — one shared rule, see useQueueBusy.
  const queueBusy = useQueueBusy();
  // A reopened panel holds no run state of its own — these ambient records
  // stand in. The board names a run still in flight on this conversation (its
  // startedAt drives the elapsed clock; the plan peek reads the transcript as
  // of reopen, not a stream); the index row keeps the summary of the run that
  // ended while the panel was away, retired by the next user message.
  const boardRun = useConversationStore((s) =>
    s.activeId !== null && s.board.running?.conversationId === s.activeId
      ? s.board.running
      : undefined,
  );
  const lastRun = useConversationStore(
    (s) => s.conversations.find((c) => c.id === s.activeId)?.lastRun,
  );

  const idleVerbs = t("run.idle", { returnObjects: true });
  const [verbIdx, setVerbIdx] = useState(0);

  // This panel's own run when it has one; the board's record of the run it
  // reopened into otherwise — but never a bridge session's: that one keeps its
  // own band, which names the client and this one cannot.
  const localLive = status === "running" && runStartedAt !== null;
  const liveStartedAt = localLive
    ? runStartedAt
    : !bridgeActive && boardRun
      ? boardRun.startedAt
      : null;
  const running = liveStartedAt !== null;
  const now = useNow(running);
  // Parked speaks "waiting": the armed approval card (panel memory, re-armed
  // on reconnect) or the board's mark (a run parked while this panel was away).
  const awaiting = awaitingApproval || boardRun?.awaiting === true;

  useEffect(() => {
    if (!running || awaiting) return;
    let rotate: ReturnType<typeof setTimeout>;
    const schedule = () => {
      // Random 1–2 min. Tools churn in under a second, so a verb that tracked
      // them read as flicker — the live rows above already name the tool.
      // The verb is mood, the shimmer is the "alive" signal; it only needs to
      // keep the bar from feeling like a frozen frame.
      rotate = setTimeout(
        () => {
          // Index 0 is the plain opener every run starts on — a fresh task
          // announcing itself as "Lollygagging" reads like the agent is
          // slacking. After that the pick is random from the rest: walking the
          // list in order means a ten-minute run only ever sees the first
          // handful, so the tail may as well not be there. Never twice in a
          // row — a repeat looks like the frozen frame this rotation exists
          // to disprove.
          setVerbIdx((i) => {
            if (idleVerbs.length < 3) return i;
            const next = 1 + Math.floor(Math.random() * (idleVerbs.length - 1));
            return next !== i ? next : next === 1 ? idleVerbs.length - 1 : next - 1;
          });
          schedule();
        },
        60_000 + Math.random() * 60_000,
      );
    };
    schedule();
    return () => clearTimeout(rotate);
  }, [running, awaiting, idleVerbs.length]);

  const totalTokens = usage.input + usage.output;
  const tokenNote =
    totalTokens > 0 ? ` · ${t("run.tokens", { count: formatTokens(totalTokens) })}` : "";

  // What the last run cost, kept up after it ends: while it streams the numbers
  // move too fast to read, and they are gone by the time you look.
  if (liveStartedAt === null) {
    // An external agent's work outranks the last run's summary — it is
    // happening now, and the browser is not the user's while it does. This is
    // the same run already blinking the driven tab's favicon, named here.
    if (bridgeActive) return <BridgeActiveBand active={bridgeActive} />;
    // This panel watched its run end; otherwise the stored summary of the run
    // that ended while the panel was closed stands in — same band either way.
    // A live error marks the band failed: "Done" over a 429 reads as a lie.
    const finished =
      runStartedAt !== null && runEndedAt !== null
        ? { startedAt: runStartedAt, endedAt: runEndedAt, ...usage, ok: status !== "error" }
        : lastRun;
    if (!finished) return null;
    const finishedTokens = finished.input + finished.output;
    const finishedNote =
      finishedTokens > 0 ? ` · ${t("run.tokens", { count: formatTokens(finishedTokens) })}` : "";
    const failed = finished.ok === false;
    return (
      <div className="flex flex-col gap-0.5 border-t border-neutral-100 px-3 py-1.5 text-xs text-neutral-400 dark:border-neutral-800 dark:text-neutral-500">
        <div className="flex items-center gap-2">
          <span className={failed ? "text-red-600 dark:text-red-400" : undefined}>
            {awaitingAnswer
              ? t("run.awaitingAnswer")
              : failed
                ? t("run.failed")
                : t("run.finished")}
          </span>
          <span className="telemetry">
            {formatDuration(finished.endedAt - finished.startedAt)}
            {finishedNote}
          </span>
        </div>
        {plan?.steps && <PlanPeek steps={plan.steps} current={plan.current ?? 0} />}
      </div>
    );
  }

  // Modulo, not a bare index: switching language mid-run swaps in a catalog
  // that may be shorter than the index we are sitting on.
  const verb = idleVerbs[verbIdx % idleVerbs.length] ?? idleVerbs[0] ?? "";

  /**
   * Loud on purpose. Something is clicking and typing in your browser right now,
   * and the muted one-liner this replaced read like a footer — you could scroll
   * past it and not register that a run was live.
   */
  return (
    <div
      role="status"
      aria-live="polite"
      className="flex flex-col gap-0.5 border-t border-brand-200 bg-brand-50 px-3 py-2 dark:border-brand-900 dark:bg-brand-950/60"
    >
      <div className="flex items-center gap-2 text-sm">
        {/* One motion only — the shimmering verb is the live signal, so the dot stays still. */}
        <span className="inline-block h-2.5 w-2.5 shrink-0 rounded-full bg-amber-400" />
        {awaiting ? (
          // Parked on the user's answer: the run is alive (the timer keeps
          // counting) but nothing is working — the shimmer would be lying.
          <span className="shrink-0 font-semibold text-brand-700 dark:text-brand-300">
            {t("run.awaitingApproval")}
          </span>
        ) : (
          <span className="shimmer-text shrink-0 font-semibold">{verb}…</span>
        )}
        <span className="telemetry ml-auto shrink-0 text-xs" aria-hidden="true">
          {formatDuration(now - liveStartedAt)}
          {tokenNote}
        </span>
      </div>
      {/* The run's target gets its own row: squeezed between the verb and the
          timer it truncated to a letter, and a chip you cannot read cannot be
          clicked. It belongs to the header, so it sits in the DOT's column,
          not the plan's — indented to 1.125rem its favicon landed exactly on
          the glyph column and the tab read as a fifth step. The -ml-1 cancels
          the pill's own pl-1 so the favicon aligns with the dot above it, and
          the plan then indents under both. */}
      {drivingTab && (
        <div className="-ml-1 flex">
          <DrivenTabChip />
        </div>
      )}
      {plan?.steps && <PlanPeek steps={plan.steps} current={plan.current ?? 0} />}
      {/* The working band is the one place the user watches while waiting —
          Claude Code's spinner-tip slot; idle/composer gets the same line. */}
      {!queueBusy && <TipLine className="text-brand-800/60 dark:text-brand-200/50" />}
    </div>
  );
}

/** How many plan rows the footer shows — the full card lives in the transcript. */
const PEEK_ROWS = 4;

/**
 * A window onto the checklist: the step just finished (for orientation), the
 * one in flight, and what comes next. When the plan is bigger than the window,
 * counts stand in for the hidden rows instead of pretending the list is short.
 */
function PlanPeek({ steps, current }: { steps: string[]; current: number }) {
  const { t } = useTranslation();
  const done = Math.min(current, steps.length);
  const from = Math.max(0, current - 1);
  const peek = steps.slice(from, from + PEEK_ROWS);
  const hiddenBefore = from;
  const hiddenAfter = steps.length - (from + peek.length);

  return (
    <div className="flex flex-col gap-0.5 pl-[1.125rem] text-xs text-brand-800/80 dark:text-brand-200/70">
      {peek.map((step, j) => {
        const i = from + j;
        return (
          <div
            key={i}
            className={
              i === current ? "flex items-start gap-1.5 font-medium" : "flex items-start gap-1.5"
            }
          >
            <PlanMark index={i} current={current} />
            <span className="truncate">{step}</span>
          </div>
        );
      })}
      {(hiddenBefore > 0 || hiddenAfter > 0) && (
        <div className="opacity-70">
          {t("plan.peekMore", { done, pending: steps.length - done })}
        </div>
      )}
    </div>
  );
}

/**
 * An external client is working in the browser and this panel is not the one
 * doing it — a bridge run or a direct-driving session. The driven tab already
 * carries the mark (blinking favicon dot, on-page badge); this band is the
 * panel's view of the same run: who it is, and that the user can take the
 * browser back.
 */
function BridgeActiveBand({ active }: { active: BridgeActive }) {
  const { t } = useTranslation();
  const stop = useConversationStore((s) => s.stop);
  return (
    <div
      role="status"
      aria-live="polite"
      className="flex items-center gap-2 border-t border-brand-200 bg-brand-50 px-3 py-2 dark:border-brand-900 dark:bg-brand-950/60"
    >
      {/* The one motion — a breathing dot. Nothing is streaming, so the copy is
          still; the dot carries the "alive" signal the live band gives its
          shimmering verb. */}
      <span className="inline-block h-2.5 w-2.5 shrink-0 animate-pulse rounded-full bg-amber-400" />
      <span className="min-w-0 flex-1 truncate text-sm font-medium text-neutral-800 dark:text-neutral-100">
        {active.mode === "direct"
          ? t("run.bridgeDriving", { client: active.client })
          : t("run.bridgeTask", { client: active.client })}
      </span>
      <Button
        size="sm"
        variant="ghost"
        className="shrink-0"
        onClick={stop}
        title={t("run.bridgeStopTitle")}
      >
        {t("chat.stop")}
      </Button>
    </div>
  );
}
