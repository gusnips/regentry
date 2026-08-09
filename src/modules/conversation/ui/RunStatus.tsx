import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useConversationStore } from "./store";
import { DrivenTabChip } from "./DrivenTabChip";
import { planGlyph } from "./plan";
import { useNow } from "./hooks";
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

  const [verbIdx, setVerbIdx] = useState(0);

  const running = status === "running" && runStartedAt !== null;
  const now = useNow(running);

  useEffect(() => {
    if (!running) return;
    let rotate: ReturnType<typeof setTimeout>;
    const schedule = () => {
      // Random 1–2 min. Tools churn in under a second, so a verb that tracked
      // them read as flicker — the live rows above already name the tool.
      // The verb is mood, the shimmer is the "alive" signal; it only needs to
      // keep the bar from feeling like a frozen frame.
      rotate = setTimeout(
        () => {
          setVerbIdx((i) => i + 1);
          schedule();
        },
        60_000 + Math.random() * 60_000,
      );
    };
    schedule();
    return () => clearTimeout(rotate);
  }, [running]);

  const totalTokens = usage.input + usage.output;
  const tokenNote =
    totalTokens > 0 ? ` · ${t("run.tokens", { count: formatTokens(totalTokens) })}` : "";

  // What the last run cost, kept up after it ends: while it streams the numbers
  // move too fast to read, and they are gone by the time you look.
  if (!running) {
    // An external agent's work outranks the last run's summary — it is
    // happening now, and the browser is not the user's while it does. This is
    // the same run already blinking the driven tab's favicon, named here.
    if (bridgeActive) return <BridgeActiveBand active={bridgeActive} />;
    if (runStartedAt === null || runEndedAt === null) return null;
    return (
      <div className="flex flex-col gap-0.5 border-t border-neutral-100 px-3 py-1.5 text-xs text-neutral-400 dark:border-neutral-800 dark:text-neutral-500">
        <div className="flex items-center gap-2">
          <span>{t("run.finished")}</span>
          <span>
            {formatDuration(runEndedAt - runStartedAt)}
            {tokenNote}
          </span>
        </div>
        {plan?.steps && <PlanPeek steps={plan.steps} current={plan.current ?? 0} />}
      </div>
    );
  }

  const idleVerbs = t("run.idle", { returnObjects: true });
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
        <span className="inline-block h-2.5 w-2.5 shrink-0 rounded-full bg-brand-500" />
        <span className="shimmer-text shrink-0 font-semibold">{verb}…</span>
        <span className="ml-auto shrink-0 font-mono text-xs text-brand-700/70 dark:text-brand-300/70">
          {formatDuration(now - runStartedAt)}
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
          <div key={i} className={i === current ? "flex gap-1.5 font-medium" : "flex gap-1.5"}>
            <span aria-hidden className="shrink-0 opacity-70">
              {planGlyph(i, current)}
            </span>
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
      <span className="inline-block h-2.5 w-2.5 shrink-0 animate-pulse rounded-full bg-brand-500" />
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
