import { useTranslation } from "react-i18next";
import { useConversationStore } from "./store";
import { useProvidersStore } from "@/modules/providers/ui";
import {
  CONTEXT_RESERVE,
  knownContextWindow,
  learnedContextLimits,
} from "@/modules/providers/context-window";
import { useStoredItem } from "@/components/useStoredItem";
import { formatTokens } from "@/lib/format";

/**
 * How full the model's context is — the number you read before deciding whether
 * to compact.
 *
 * **It shows a token count, not a percentage.** A percentage needs a
 * denominator, and for most providers nobody can tell us one: the extension is
 * provider-agnostic, any `baseUrl` can serve any model id, and no table stays
 * current. "42% full" against a number we guessed is a made-up statistic, and
 * the user would act on it. So the count — which we measure — always shows, and
 * the bar joins it only when the window is genuinely known (learned from a real
 * rejection, or reported by the endpoint's own listing). When it is, the pair
 * reads "24.3k / 200k" and the bar is that ratio; when it isn't, the count
 * stands alone and claims nothing.
 *
 * **It outlives the run.** Panel state dies with the panel, so the reading falls
 * back to the last turn's input persisted on the conversation — a reopened
 * panel shows the same number it showed before, instead of blanking until the
 * next run. Only a conversation that has never run a turn has nothing to say.
 *
 * Gold, because it measures rather than acts; red once inside the reserve,
 * where the number has stopped being information and become an instruction.
 */
export function ContextGauge() {
  const { t } = useTranslation();
  const live = useConversationStore((s) => s.contextTokens);
  // The run that ended — including one that ended while the panel was closed.
  const stored = useConversationStore(
    (s) => s.conversations.find((c) => c.id === s.activeId)?.lastRun?.lastInput ?? 0,
  );
  const learned = useStoredItem(learnedContextLimits);
  // Same resolution the header chips and slash commands use: the stored pick,
  // else the first configured one. Without the fallback an un-pinned provider
  // (the common case — nobody picks one until they have two) rendered nothing.
  const provider = useProvidersStore(
    (s) => s.providers.find((p) => p.id === s.activeId) ?? s.providers[0],
  );

  const used = live > 0 ? live : stored;
  // Nothing has been measured yet — a gauge reading zero would be a claim we
  // cannot make. It appears with the first turn that reports its usage.
  if (used <= 0 || !provider) return null;

  const window = knownContextWindow(provider, learned);
  const pressured = window !== undefined && used >= window - CONTEXT_RESERVE;
  const percent = window ? Math.min(100, Math.round((used / window) * 100)) : 0;

  return (
    <span
      className="inline-flex shrink-0 items-center gap-1"
      title={
        window
          ? t("context.tooltip", { used: formatTokens(used), window: formatTokens(window) })
          : t("context.tooltipUnknown", { used: formatTokens(used) })
      }
    >
      {window !== undefined && (
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
      )}
      <span
        className={
          pressured
            ? "font-mono text-[11px] tabular-nums text-red-600 dark:text-red-400"
            : "telemetry text-[11px]"
        }
      >
        {window !== undefined
          ? t("context.usedOf", { used: formatTokens(used), window: formatTokens(window) })
          : t("context.used", { used: formatTokens(used) })}
      </span>
    </span>
  );
}
