import { useTranslation } from "react-i18next";
import { useConversationStore } from "./store";
import { useProvidersStore } from "@/modules/providers/ui";
import {
  CONTEXT_RESERVE,
  contextWindowFor,
  learnedContextLimits,
} from "@/modules/providers/context-window";
import { useStoredItem } from "@/components/useStoredItem";
import { formatTokens } from "@/lib/format";

/**
 * How full the model's context is, in the run band's telemetry cluster —
 * beside the elapsed time and the run's token count, which is where every
 * other measurement already reads. It outlives the run there: the settled band
 * stays up until the next message, which is exactly the moment you'd decide
 * whether to compact before typing.
 *
 * Shown only once a turn has actually reported its input tokens: before that
 * there is no measurement, and a gauge reading 0% would be a claim we can't
 * make. The denominator is the best number available (learned ceiling → the
 * endpoint's listing → the 200k default; see providers/context-window.ts), and
 * the tooltip names it so a wrong guess is legible rather than mysterious.
 *
 * A bar plus a percentage, not the raw pair: the cluster it joins is already
 * two numbers long, and "24k / 200k" would make it three. The exact figures are
 * one hover away, which is where they belong — they only matter when you have
 * already decided to look. Gold while it measures; red once past the fold
 * threshold, because at that point the number has become an instruction.
 */
export function ContextGauge() {
  const { t } = useTranslation();
  const used = useConversationStore((s) => s.contextTokens);
  const learned = useStoredItem(learnedContextLimits);
  const provider = useProvidersStore((s) => s.providers.find((p) => p.id === s.activeId));

  // No turn has reported usage yet — nothing measured, so nothing claimed.
  if (used <= 0 || !provider) return null;

  const window = contextWindowFor(provider, learned);
  const percent = Math.min(100, Math.round((used / window) * 100));
  const pressured = used >= window - CONTEXT_RESERVE;

  return (
    <span
      className="inline-flex shrink-0 items-center gap-1"
      title={t("context.tooltip", {
        used: formatTokens(used),
        window: formatTokens(window),
        percent,
      })}
    >
      <span
        aria-hidden
        className="h-1 w-8 overflow-hidden rounded-full bg-neutral-200 dark:bg-neutral-700"
      >
        <span
          className={`block h-full rounded-full transition-[width] duration-500 ${
            pressured ? "bg-red-500 dark:bg-red-400" : "bg-amber-500 dark:bg-amber-300"
          }`}
          style={{ width: `${Math.max(percent, 2)}%` }}
        />
      </span>
      <span
        className={`text-[11px] ${pressured ? "font-mono tabular-nums text-red-600 dark:text-red-400" : "telemetry"}`}
      >
        {percent}%
      </span>
    </span>
  );
}
