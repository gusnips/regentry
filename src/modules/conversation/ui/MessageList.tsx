import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useConversationStore } from "./store";
import { Markdown } from "./Markdown";
import { planGlyph } from "./plan";
import { groupBursts, type Burst } from "./bursts";
import { useNow } from "./hooks";
import { toolVerbKey, toolHint } from "./tool-labels";
import { pendingAskId } from "./ask-gate";
import type { Message } from "../types";
import { splitErrorDetail } from "../error-detail";
import type { ErrorKind } from "@/modules/providers/error-classify";
import { formatDuration } from "@/lib/format";
import { showReasoning } from "@/lib/prefs";
import { AddProviderDialog, useProvidersStore } from "@/modules/providers/ui";
import type { ProviderConfig } from "@/modules/providers/types";
import { Button } from "@/components/Button";
import { Bubble, BubbleContent } from "@/components/Bubble";
import {
  MessageScroller,
  MessageScrollerContent,
  MessageScrollerItem,
  MessageScrollerProvider,
  MessageScrollerViewport,
  useMessageScroller,
  useMessageScrollerScrollable,
} from "@/components/MessageScroller";
import { ZoomableImage } from "@/components/ZoomableImage";
import { useStoredItem } from "@/components/useStoredItem";

type HintKey =
  "badKey" | "signedOut" | "quota" | "rateLimited" | "rejected" | "network" | "noProvider";
type CtaKey = "updateKey" | "signIn" | "checkUrl" | "addProvider";

const HINT_KEYS = {
  badKey: "chat.hint.badKey",
  signedOut: "chat.hint.signedOut",
  quota: "chat.hint.quota",
  rateLimited: "chat.hint.rateLimited",
  rejected: "chat.hint.rejected",
  network: "chat.hint.network",
  noProvider: "chat.hint.noProvider",
} as const;

const CTA_KEYS = {
  updateKey: "chat.cta.updateKey",
  signIn: "chat.cta.signIn",
  checkUrl: "chat.cta.checkUrl",
  addProvider: "chat.cta.addProvider",
} as const;

/**
 * Raw provider/agent error → likely-cause key + fix (house rule: never a bare error).
 * Regexes match the raw English provider text — provider errors arrive in English
 * regardless of UI locale. `cta` opens the provider setup dialog in place.
 *
 * `signedIn` swaps the credential advice: a subscription provider holds no key,
 * so "update your API key" would send that user looking for something that
 * doesn't exist — the fix there is signing in again.
 */
function errorHint(message: string, signedIn: boolean): { key: HintKey; cta?: CtaKey } | null {
  const m = message.toLowerCase();
  // Quota first: a 403/429 body that talks about billing is not a bad key, and
  // telling the user to re-enter a working key would send them the wrong way.
  if (/usage limit|quota|out of credit|insufficient (balance|credit|funds)|billing/.test(m))
    return { key: "quota", cta: "addProvider" };
  if (/401|403|unauthorized|forbidden|invalid api key|authentication|sign-in/.test(m))
    return signedIn ? { key: "signedOut", cta: "signIn" } : { key: "badKey", cta: "updateKey" };
  if (/429|rate limit/.test(m)) return { key: "rateLimited" };
  if (/400|invalid/.test(m)) return { key: "rejected" };
  if (/failed to fetch|networkerror|network/.test(m)) return { key: "network", cta: "checkUrl" };
  if (/no (active )?provider/.test(m)) return { key: "noProvider", cta: "addProvider" };
  return null;
}

/**
 * Classified provider failure → the fix action it offers. No hint text: the
 * classified message already leads with its own actionable line, so a second
 * generic line below it would only paraphrase it.
 */
function kindCta(kind: ErrorKind, signedIn: boolean): CtaKey | undefined {
  if (kind === "quota") return "addProvider";
  if (kind === "auth") return signedIn ? "signIn" : "updateKey";
  return undefined;
}

function StepIcon({ live, ok }: { live?: boolean; ok?: boolean }) {
  if (live)
    return (
      <span
        role="status"
        className="h-2.5 w-2.5 shrink-0 animate-spin rounded-full border border-neutral-300 border-t-brand-500 dark:border-neutral-600 dark:border-t-brand-400"
      />
    );
  if (ok === false) return <span className="text-red-500 dark:text-red-400">✗</span>;
  if (ok === true) return <span className="text-neutral-400 dark:text-neutral-500">✓</span>;
  return <span className="text-neutral-300 dark:text-neutral-600">•</span>;
}

/**
 * One tool call: a single quiet line by default, expandable to what the tool
 * actually saw. The transcript stays scannable, but nothing the agent did to
 * your browser is hidden from you.
 */
function StepRow({ msg }: { msg: Message }) {
  const { t } = useTranslation();
  const key = toolVerbKey(msg.tool);
  const label = key ? t(key) : msg.tool;
  const hint = toolHint(msg.tool, msg.args);
  // A failure's summary IS the error — it must stay on the visible line.
  const trailing = msg.ok === false ? msg.content : (hint ?? msg.content);
  // The row fits one line, so the drawer carries whichever fact it displaced:
  // for a failure that is the attempt itself ("switch to tab 42"), which is
  // exactly what you open a red row to find out.
  const displaced = msg.ok === false ? hint : hint ? msg.content : undefined;
  const expandable = !msg.live && Boolean(msg.detail || msg.images?.length);

  const line = (
    <>
      <StepIcon live={msg.live} ok={msg.ok} />
      <span className="font-medium">{label}</span>
      {!msg.live && trailing && (
        <span className="truncate text-neutral-400 dark:text-neutral-500">{trailing}</span>
      )}
    </>
  );

  if (!expandable) {
    return (
      <div className="flex items-center gap-1.5 self-start px-1 text-xs text-neutral-500 dark:text-neutral-400">
        {line}
      </div>
    );
  }

  return (
    <details className="group max-w-full self-start px-1 text-xs text-neutral-500 dark:text-neutral-400">
      <summary className="flex cursor-pointer list-none items-center gap-1.5 select-none hover:text-neutral-700 dark:hover:text-neutral-300">
        {line}
        <span className="shrink-0 text-neutral-300 transition-transform group-open:rotate-90 dark:text-neutral-600">
          ▸
        </span>
      </summary>
      <div className="mt-1 ml-4 flex flex-col gap-1.5">
        {displaced && <div>{displaced}</div>}
        {msg.images?.map((src, i) => (
          <ZoomableImage
            key={i}
            src={src}
            alt={t("chat.screenshotAlt")}
            className="max-h-64 rounded border border-neutral-200 object-contain dark:border-neutral-700"
          />
        ))}
        {msg.detail && (
          <pre className="max-h-48 overflow-auto rounded bg-neutral-100 p-1.5 font-mono text-[11px] break-all whitespace-pre-wrap text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300">
            {msg.detail}
          </pre>
        )}
      </div>
    </details>
  );
}

/**
 * The agent paused for a decision — ask_user rendered as a card, not a step
 * row: the question is the headline. An answer is just the next user message,
 * so history replay reads it as a plain turn.
 *
 * The choices are laid out on the USER's side, right-aligned toward the
 * composer, in the same brand chip language as a queued message: tapping one
 * sends it verbatim, so it is a draft reply of yours, not a control of the
 * agent's. Answered questions keep the question and drop the chips — the reply
 * is already in the transcript right below. A question with no choices is an
 * OPEN question: no chips to tap, so the card names where the answer goes —
 * a hint while (and only while) the question still awaits one. Once answered,
 * both hint and chips drop and the bare question stays.
 */
function QuestionCard({ msg, onAnswer }: { msg: Message; onAnswer?: (text: string) => void }) {
  const { t } = useTranslation();
  const listed = Array.isArray(msg.args?.choices) ? msg.args.choices : [];
  // Deduped: a repeated option is a dead chip — and a duplicate React key.
  const choices = [
    ...new Set(listed.filter((c): c is string => typeof c === "string" && c.trim() !== "")),
  ];

  const question = (
    <Bubble variant="muted" className="border border-brand-200 dark:border-brand-900">
      <BubbleContent>
        <Markdown>{msg.content}</Markdown>
      </BubbleContent>
    </Bubble>
  );
  if (!onAnswer) return question;

  return (
    <div className="flex flex-col gap-1.5">
      {question}
      <div className="flex flex-col items-end gap-1">
        {choices.length > 0 && (
          <div className="flex max-w-[85%] flex-wrap justify-end gap-1.5">
            {choices.map((c) => (
              <Button key={c} variant="choice" size="sm" onClick={() => onAnswer(c)}>
                {c}
              </Button>
            ))}
          </div>
        )}
        <span className="text-[11px] text-neutral-400 dark:text-neutral-500">
          {t(choices.length > 0 ? "chat.askUserHint" : "chat.askUserOpenHint")}
        </span>
      </div>
    </div>
  );
}

/**
 * The run is parked on a decision: the plan the agent wants to execute. This is
 * the safety gate — nothing that changes the browser runs until the user says
 * yes, and a mid-run replan that deviates from what was approved asks again.
 * Rendered at the transcript's live edge, where the eye already is; answering
 * it resumes or ends the run, so the card itself is never persisted.
 */
function PlanApprovalCard({
  steps,
  reapproval,
  onApprove,
  onReject,
  onRevise,
}: {
  steps: string[];
  reapproval: boolean;
  onApprove: () => void;
  onReject: () => void;
  onRevise: (feedback: string) => void;
}) {
  const { t } = useTranslation();
  // "Adjust" swaps the buttons for the note the plan goes back with — the run
  // stays alive and the revised plan comes back here for a fresh approval.
  const [adjusting, setAdjusting] = useState(false);
  const [note, setNote] = useState("");
  const sendable = note.trim().length > 0;

  return (
    <div className="flex max-w-[85%] flex-col gap-2 self-start rounded-lg border border-brand-200 bg-brand-50 px-3 py-2 dark:border-brand-900 dark:bg-brand-950/60">
      <div className="text-sm font-medium text-neutral-800 dark:text-neutral-100">
        {t(reapproval ? "plan.reapprovalTitle" : "plan.approvalTitle")}
      </div>
      <ol className="flex flex-col gap-0.5 text-xs text-neutral-600 dark:text-neutral-300">
        {steps.map((step, i) => (
          <li key={i} className="flex gap-1.5">
            <span aria-hidden className="shrink-0 opacity-70">
              ○
            </span>
            <span>{step}</span>
          </li>
        ))}
      </ol>
      {adjusting ? (
        <div className="flex flex-col gap-2">
          <textarea
            autoFocus
            rows={2}
            value={note}
            placeholder={t("plan.adjustPlaceholder")}
            onChange={(e) => setNote(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey && sendable) {
                e.preventDefault();
                onRevise(note);
              } else if (e.key === "Escape") {
                setAdjusting(false);
              }
            }}
            className="w-full resize-none rounded-md border border-neutral-300 bg-white px-2 py-1.5 text-xs text-neutral-800 placeholder:text-neutral-400 focus:border-brand-400 focus:outline-none dark:border-neutral-600 dark:bg-neutral-900 dark:text-neutral-100"
          />
          <div className="flex gap-2">
            <Button size="sm" disabled={!sendable} onClick={() => onRevise(note)}>
              {t("chat.send")}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setAdjusting(false)}>
              {t("common.cancel")}
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex gap-2">
          <Button size="sm" onClick={onApprove}>
            {t("plan.approve")}
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setAdjusting(true)}>
            {t("plan.adjust")}
          </Button>
          <Button size="sm" variant="ghost" onClick={onReject}>
            {t("plan.reject")}
          </Button>
        </div>
      )}
    </div>
  );
}

/**
 * The agent's checklist. Collapsed it shows only the step in flight, which is
 * the one thing you want while it works; expanded it shows the whole route so
 * you can tell early that the agent misread the task and stop it. Once the run
 * ends there is no "in flight" anymore — the card stays open so the plan does
 * not vanish into a one-line summary. E folds/unfolds every card at once
 * (plansOpen from Transcript); a summary click folds back into local control.
 */
function PlanCard({
  steps,
  current,
  settled,
  plansOpen,
}: {
  steps: string[];
  current: number;
  settled?: boolean;
  /** Global E-toggle — null leaves the card to its own default. */
  plansOpen: boolean | null;
}) {
  const { t } = useTranslation();
  const done = Math.min(current, steps.length);
  const active = settled ? undefined : steps[current];
  // What the card would do on its own: the global E-toggle when pressed,
  // otherwise open when settled / no step in flight. A summary click overrides
  // until the auto state moves again (render-time adjustment, no effect).
  const auto = plansOpen ?? (settled || !active);
  const [clicked, setClicked] = useState<boolean | null>(null);
  const [prevAuto, setPrevAuto] = useState(auto);
  if (auto !== prevAuto) {
    setPrevAuto(auto);
    setClicked(null);
  }
  const open = clicked ?? auto;

  return (
    <details
      open={open}
      onToggle={(e) => setClicked(e.currentTarget.open)}
      className="group max-w-[85%] self-start rounded-lg border border-neutral-200 px-3 py-1.5 text-xs dark:border-neutral-700"
    >
      <summary className="flex cursor-pointer list-none items-center gap-1.5 select-none">
        <span className="inline-block text-neutral-300 transition-transform group-open:rotate-90 dark:text-neutral-600">
          ▸
        </span>
        <span className="font-medium text-neutral-700 dark:text-neutral-200">
          {t("plan.title")}
        </span>
        <span className="text-neutral-400 dark:text-neutral-500">
          {t("plan.progress", { done, total: steps.length })}
        </span>
        {active && (
          <span className="truncate text-neutral-500 dark:text-neutral-400">· {active}</span>
        )}
      </summary>
      <ol className="mt-1 flex flex-col gap-0.5">
        {steps.map((step, i) => (
          <li
            key={i}
            className={
              i < current
                ? "flex gap-1.5 text-neutral-400 line-through dark:text-neutral-600"
                : i === current
                  ? "flex gap-1.5 font-medium text-neutral-800 dark:text-neutral-100"
                  : "flex gap-1.5 text-neutral-500 dark:text-neutral-400"
            }
          >
            <span aria-hidden className="shrink-0">
              {planGlyph(i, current)}
            </span>
            <span>{step}</span>
          </li>
        ))}
      </ol>
    </details>
  );
}

/**
 * Reasoning collapses to a one-line summary by default — a wall of tokens is
 * noise for most runs, and "Thought for 3m 48s" says everything that matters.
 * The show/toggle preference is one stored value for ALL blocks, so it is read
 * and watched once in MessageList and handed down.
 */
function ReasoningBlock({
  text,
  startedAt,
  elapsed,
  show,
  onToggle,
}: {
  text: string;
  /** Present while the segment is still streaming. */
  startedAt?: number | null;
  /** Recorded duration once persisted. */
  elapsed?: number;
  show: boolean;
  onToggle: () => void;
}) {
  const { t } = useTranslation();
  const live = startedAt != null;
  const now = useNow(live);

  const duration = formatDuration(live ? now - (startedAt ?? now) : (elapsed ?? 0));

  return (
    <div className="max-w-[85%] self-start rounded-lg border border-neutral-200 px-3 py-1.5 text-xs text-neutral-500 dark:border-neutral-700 dark:text-neutral-400">
      <button
        type="button"
        aria-expanded={show}
        onClick={onToggle}
        title={t("chat.reasoningToggle")}
        className="flex w-full items-center gap-1.5 rounded select-none hover:text-neutral-700 focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:outline-none dark:hover:text-neutral-300"
      >
        {live ? (
          /* The same shimmer as the run bar: one visual language for "alive". */
          <span className="shimmer-text font-medium">{t("chat.thinkingFor", { duration })}</span>
        ) : (
          <>
            <span
              aria-hidden
              className={`inline-block transition-transform ${show ? "rotate-90" : ""}`}
            >
              ▸
            </span>
            <span className="font-medium">{t("chat.thoughtFor", { duration })}</span>
          </>
        )}
      </button>
      {show && <div className="mt-1 break-words whitespace-pre-wrap">{text}</div>}
    </div>
  );
}

/** A thought inside an expanded burst: a quiet line, not a card. Clicking it turns reasoning back on for everyone. */
function QuietThought({ msg, onToggle }: { msg: Message; onToggle: () => void }) {
  const { t } = useTranslation();
  return (
    <button
      type="button"
      onClick={onToggle}
      title={t("chat.reasoningToggle")}
      className="flex items-center gap-1.5 self-start rounded select-none hover:text-neutral-700 focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:outline-none dark:hover:text-neutral-300"
    >
      <span aria-hidden className="text-neutral-300 dark:text-neutral-600">
        ▸
      </span>
      <span className="font-medium">
        {t("chat.thoughtFor", { duration: formatDuration(msg.elapsed ?? 0) })}
      </span>
    </button>
  );
}

/** Tool → plural count key for the burst summary ("5 clicks"). Unknown tools fold into "other actions". */
const BURST_COUNT_KEYS = {
  navigate: "chat.burstCount.navigate",
  snapshot: "chat.burstCount.snapshot",
  click: "chat.burstCount.click",
  type: "chat.burstCount.type",
  press_key: "chat.burstCount.pressKey",
  scroll_down: "chat.burstCount.scroll",
  scroll_up: "chat.burstCount.scroll",
  screenshot: "chat.burstCount.screenshot",
  remember: "chat.burstCount.remember",
} as const;

type BurstCountKey =
  (typeof BURST_COUNT_KEYS)[keyof typeof BURST_COUNT_KEYS] | "chat.burstCount.action";

function burstCountKey(tool: string | undefined): BurstCountKey {
  return BURST_COUNT_KEYS[tool as keyof typeof BURST_COUNT_KEYS] ?? "chat.burstCount.action";
}

/**
 * A collapsed action run: one quiet line — "Thinking for 4m 12s, 5 clicks,
 * 3 entries and 2 page reads · 6m 40s" — that expands back to the rows it
 * replaces. The thinking segment only appears when the run actually thought;
 * a thought-free run is counts only ("5 clicks and 2 page reads · 40s").
 * Counts keep the run's shape without truncation; the per-action hints live on
 * the expanded rows. Live bursts stay open (same rule as the plan card) and
 * settle closed when the run ends.
 */
function BurstCard({ burst, onToggleReasoning }: { burst: Burst; onToggleReasoning: () => void }) {
  const { t, i18n } = useTranslation();
  const now = useNow(burst.live);
  const last = burst.items[burst.items.length - 1];
  const elapsed =
    (burst.endedAt ?? (burst.live ? now : (last?.timestamp ?? burst.startedAt))) - burst.startedAt;
  const failed = burst.steps.some((s) => s.ok === false);

  const thinkMs = burst.items.reduce(
    (sum, m) => sum + (m.role === "reasoning" ? (m.elapsed ?? 0) : 0),
    0,
  );
  const counts = new Map<BurstCountKey, number>();
  for (const s of burst.steps) {
    const key = burstCountKey(s.tool);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const list = new Intl.ListFormat(i18n.language, { type: "conjunction" }).format([
    ...(thinkMs > 0 ? [t("chat.burstThinking", { duration: formatDuration(thinkMs) })] : []),
    ...[...counts].map(([key, count]) => t(key, { count })),
  ]);

  return (
    <details
      open={burst.live}
      className="group max-w-full self-start px-1 text-xs text-neutral-500 dark:text-neutral-400"
    >
      <summary className="flex cursor-pointer list-none items-center gap-1.5 select-none hover:text-neutral-700 dark:hover:text-neutral-300">
        <span className="shrink-0 text-neutral-300 transition-transform group-open:rotate-90 dark:text-neutral-600">
          ▸
        </span>
        <StepIcon live={burst.live} ok={failed ? false : true} />
        <span className="truncate">{list}</span>
        <span className="shrink-0 text-neutral-400 dark:text-neutral-500">
          · {formatDuration(elapsed)}
        </span>
      </summary>
      <div className="mt-1 ml-4 flex flex-col gap-1.5">
        {burst.items.map((m) =>
          m.role === "step" ? (
            <StepRow key={m.id} msg={m} />
          ) : (
            <QuietThought key={m.id} msg={m} onToggle={onToggleReasoning} />
          ),
        )}
      </div>
    </details>
  );
}

/** The assistant bubble — rendered for stored messages and the live stream alike. */
function AssistantBubble({ content, cursor }: { content: string; cursor?: boolean }) {
  return (
    <Bubble>
      <BubbleContent>
        <Markdown>{content}</Markdown>
        {cursor && <span className="animate-pulse">▊</span>}
      </BubbleContent>
    </Bubble>
  );
}

/** Ghost-button override for actions inside the red error bubble. */
const ERROR_ACTION_CLASSES =
  "text-red-700 hover:bg-red-100 dark:text-red-300 dark:hover:bg-red-900";

/**
 * Where a user message was sent from. Rendered only when the conversation
 * spans more than one tab — with a single tab every message is obviously
 * there, so the label would be noise.
 */
/** Host for tabs that never set a title — an empty stamp reads as a bug. */
function hostnameOf(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}

function TabStamp({ tab }: { tab: NonNullable<Message["tab"]> }) {
  const [iconOk, setIconOk] = useState(true);
  const label = tab.title || hostnameOf(tab.url);
  return (
    <span
      title={tab.url}
      className="flex max-w-[85%] min-w-0 items-center gap-1 text-[11px] text-neutral-400 dark:text-neutral-500"
    >
      {tab.favIconUrl && iconOk && (
        <img
          src={tab.favIconUrl}
          alt=""
          className="h-3 w-3 shrink-0 rounded-[2px]"
          onError={() => setIconOk(false)}
        />
      )}
      <span className="truncate">{label}</span>
    </span>
  );
}

function MessageBubble({
  msg,
  activeProvider,
  onRetry,
  onAnswer,
  showReasoningOn,
  onToggleReasoning,
  showTab,
  planSettled,
  plansOpen,
}: {
  msg: Message;
  activeProvider?: ProviderConfig;
  /** Present only on the newest error while idle — retry re-sends the same task. */
  onRetry?: () => void;
  /** Present only on the newest unanswered ask_user while idle — the answer starts the next run. */
  onAnswer?: (text: string) => void;
  showReasoningOn: boolean;
  onToggleReasoning: () => void;
  /** The conversation spans more than one tab, so user messages name theirs. */
  showTab: boolean;
  /** The run has ended — plan cards stay open instead of collapsing to a summary. */
  planSettled?: boolean;
  /** The E-toggle's target state for every plan card — null leaves each to its default. */
  plansOpen: boolean | null;
}) {
  const { t } = useTranslation();
  switch (msg.role) {
    case "user":
      return (
        <div className="flex flex-col items-end gap-0.5">
          {showTab && msg.tab && <TabStamp tab={msg.tab} />}
          <Bubble variant="default" align="end" className="gap-1.5">
            {msg.images?.map((src, i) => (
              <ZoomableImage
                key={i}
                src={src}
                alt={t("chat.attachmentAlt", { number: i + 1 })}
                className="max-h-48 rounded border border-white/25 object-contain"
              />
            ))}
            {msg.content}
          </Bubble>
        </div>
      );
    case "assistant":
      return <AssistantBubble content={msg.content} />;
    case "reasoning":
      return (
        <ReasoningBlock
          text={msg.content}
          elapsed={msg.elapsed}
          show={showReasoningOn}
          onToggle={onToggleReasoning}
        />
      );
    case "step":
      return msg.tool === "ask_user" ? (
        <QuestionCard msg={msg} onAnswer={onAnswer} />
      ) : (
        <StepRow msg={msg} />
      );
    case "plan":
      return msg.steps?.length ? (
        <PlanCard
          steps={msg.steps}
          current={msg.current ?? 0}
          settled={planSettled}
          plansOpen={plansOpen}
        />
      ) : null;
    case "error": {
      const signedIn = Boolean(activeProvider?.auth);
      // A provider-classified error carries its kind: its lead line is the
      // whole guidance, so the generic hint is skipped and the raw English
      // tail stays behind Details. Unclassified errors keep the regex hint.
      const hint = msg.kind ? null : errorHint(msg.content, signedIn);
      const cta = msg.kind ? kindCta(msg.kind, signedIn) : hint?.cta;
      const { summary, lead, detail } = splitErrorDetail(msg.content);
      return (
        <Bubble variant="destructive">
          <div className="whitespace-pre-wrap">{msg.kind ? lead : summary}</div>
          {detail && (
            <details className="group mt-1">
              <summary className="cursor-pointer list-none text-xs text-red-500 select-none hover:text-red-700 dark:text-red-400 dark:hover:text-red-300">
                <span className="mr-1 inline-block transition-transform group-open:rotate-90">
                  ▸
                </span>
                {t("chat.details")}
              </summary>
              <pre className="mt-1 max-h-40 overflow-auto rounded bg-red-100/70 p-1.5 font-mono text-xs break-all whitespace-pre-wrap text-red-700 dark:bg-red-900/40 dark:text-red-300">
                {detail}
              </pre>
            </details>
          )}
          {hint && (
            <div className="mt-1 text-xs text-red-600 dark:text-red-400">
              {t(HINT_KEYS[hint.key])}
            </div>
          )}
          <div className="mt-1 -ml-2 flex flex-wrap items-center gap-1">
            {onRetry && (
              <Button variant="ghost" size="sm" onClick={onRetry} className={ERROR_ACTION_CLASSES}>
                {t("chat.retry")}
              </Button>
            )}
            {cta && (
              <AddProviderDialog
                initialProvider={activeProvider}
                trigger={
                  <Button variant="ghost" size="sm" className={ERROR_ACTION_CLASSES}>
                    {t(CTA_KEYS[cta])}
                  </Button>
                }
              />
            )}
          </div>
        </Bubble>
      );
    }
  }
}

export function MessageList() {
  const { t } = useTranslation();
  const messages = useConversationStore((s) => s.messages);
  const streamingText = useConversationStore((s) => s.streamingText);

  if (messages.length === 0 && !streamingText) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-2 p-6 text-center">
        <div className="text-sm font-medium text-neutral-700 dark:text-neutral-200">
          {t("chat.emptyTitle")}
        </div>
        <p className="max-w-[240px] text-xs text-neutral-500 dark:text-neutral-400">
          {t("chat.emptyBody")}
        </p>
        <p className="mt-2 text-xs text-neutral-400 dark:text-neutral-500">
          {t("chat.emptyExample")}
        </p>
      </div>
    );
  }

  return (
    <MessageScrollerProvider
      autoScroll
      // Reopened transcripts land on the last turn with a peek of what came
      // before, instead of flying by from the top.
      defaultScrollPosition="last-anchor"
      // Same stick threshold as before the scroller: near-bottom follows.
      scrollEdgeThreshold={80}
    >
      <Transcript />
    </MessageScrollerProvider>
  );
}

/** Rows + jump pill. The scroller hooks must run under the Provider. */
function Transcript() {
  const { t } = useTranslation();
  const messages = useConversationStore((s) => s.messages);
  const streamingText = useConversationStore((s) => s.streamingText);
  const reasoningText = useConversationStore((s) => s.reasoningText);
  const reasoningStartedAt = useConversationStore((s) => s.reasoningStartedAt);
  const status = useConversationStore((s) => s.status);
  const lastRun = useConversationStore((s) => s.lastRun);
  const retry = useConversationStore((s) => s.retry);
  const sendTask = useConversationStore((s) => s.sendTask);
  const planApproval = useConversationStore((s) => s.planApproval);
  const approvePlan = useConversationStore((s) => s.approvePlan);
  const rejectPlan = useConversationStore((s) => s.rejectPlan);
  const revisePlan = useConversationStore((s) => s.revisePlan);
  const activeProvider = useProvidersStore((s) => s.providers.find((p) => p.id === s.activeId));
  // One global preference, read and watched once here — never per reasoning block.
  const showReasoningOn = useStoredItem(showReasoning);
  const toggleReasoning = () => void showReasoning.set(!showReasoningOn);
  const hasLiveStep = messages.some((m) => m.live);
  // The newest unanswered question keeps its answer affordance — the gate is
  // shared with the composer's answer placeholder (ask-gate.ts).
  const tappableAskId = pendingAskId(messages, status);
  // User messages name their tab only once a conversation spans more than one —
  // with a single tab every message is obviously there, so the label is noise.
  const multiTab =
    new Set(messages.flatMap((m) => (m.role === "user" && m.tab ? [m.tab.url] : []))).size > 1;
  // `end` is "unseen content below the viewport" — the old !stuck: true once
  // the reader scrolls off the live edge, so the pill shows exactly then.
  const { end: offEnd } = useMessageScrollerScrollable();
  const { scrollToEnd } = useMessageScroller();

  // E unfolds every plan card (all steps) and folds them back. null means each
  // card follows its own default: current step only mid-run, open once settled.
  const [plansOpen, setPlansOpen] = useState<boolean | null>(null);
  const hasPlan = messages.some((m) => m.role === "plan" && m.steps?.length);
  useEffect(() => {
    if (!hasPlan) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "e" || e.ctrlKey || e.metaKey || e.altKey) return;
      // A Base UI overlay's own keys win, and typing must never toggle.
      if (
        document.querySelector(
          '[role="dialog"],[role="alertdialog"],[role="menu"],[role="listbox"]',
        )
      )
        return;
      if (e.target instanceof HTMLElement && e.target.closest("input,textarea,[contenteditable]"))
        return;
      // First press counters the live default: expand mid-run, compact once settled.
      setPlansOpen((v) => !(v ?? status !== "running"));
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [hasPlan, status]);

  return (
    <MessageScroller>
      <MessageScrollerViewport>
        <MessageScrollerContent>
          {(showReasoningOn
            ? messages.map((m) => ({ kind: "message" as const, msg: m }))
            : groupBursts(messages, status === "running")
          ).map((item) =>
            item.kind === "burst" ? (
              <MessageScrollerItem key={item.id} messageId={item.id}>
                <BurstCard burst={item} onToggleReasoning={toggleReasoning} />
              </MessageScrollerItem>
            ) : (
              <MessageScrollerItem
                key={item.msg.id}
                messageId={item.msg.id}
                scrollAnchor={item.msg.role === "user"}
              >
                <MessageBubble
                  msg={item.msg}
                  activeProvider={activeProvider}
                  showReasoningOn={showReasoningOn}
                  onToggleReasoning={toggleReasoning}
                  showTab={multiTab}
                  planSettled={status !== "running"}
                  plansOpen={plansOpen}
                  onRetry={
                    // Only the newest error offers Retry, and only once the run has settled.
                    item.msg.role === "error" &&
                    item.msg.id === messages[messages.length - 1]?.id &&
                    status !== "running" &&
                    lastRun
                      ? retry
                      : undefined
                  }
                  onAnswer={
                    item.msg.id === tappableAskId ? (text) => void sendTask(text) : undefined
                  }
                />
              </MessageScrollerItem>
            ),
          )}
          {reasoningText && (
            <MessageScrollerItem>
              <ReasoningBlock
                text={reasoningText}
                startedAt={reasoningStartedAt}
                show={showReasoningOn}
                onToggle={toggleReasoning}
              />
            </MessageScrollerItem>
          )}
          {planApproval && (
            <MessageScrollerItem>
              <PlanApprovalCard
                steps={planApproval.steps}
                reapproval={planApproval.reapproval}
                onApprove={approvePlan}
                onReject={rejectPlan}
                onRevise={revisePlan}
              />
            </MessageScrollerItem>
          )}
          {streamingText && (
            <MessageScrollerItem>
              <AssistantBubble content={streamingText} cursor={status === "running"} />
            </MessageScrollerItem>
          )}
          {/* Dots cover the gaps only — a live tool row carries its own spinner,
              and a parked approval is not a gap: the run is waiting on the user,
              not working, so "working…" under the card would rush a decision
              that has all the time it needs. */}
          {status === "running" &&
            !planApproval &&
            !streamingText &&
            !reasoningText &&
            !hasLiveStep && (
              <MessageScrollerItem>
                <Bubble
                  variant="muted"
                  role="status"
                  aria-label={t("chat.working")}
                  className="py-2.5"
                >
                  <span className="flex items-center gap-1">
                    {[0, 150, 300].map((d) => (
                      <span
                        key={d}
                        className="h-1.5 w-1.5 animate-bounce rounded-full bg-neutral-400 dark:bg-neutral-500"
                        style={{ animationDelay: `${d}ms` }}
                      />
                    ))}
                  </span>
                </Bubble>
              </MessageScrollerItem>
            )}
        </MessageScrollerContent>
      </MessageScrollerViewport>
      {offEnd && (
        <Button
          variant="ghost"
          size="sm"
          onClick={() => void scrollToEnd({ behavior: "smooth" })}
          className="absolute bottom-3 left-1/2 -translate-x-1/2 rounded-full border border-neutral-200 bg-white shadow-md hover:bg-neutral-50 dark:border-neutral-700 dark:bg-neutral-900 dark:hover:bg-neutral-800"
        >
          {t("chat.jumpToLatest")}
        </Button>
      )}
    </MessageScroller>
  );
}
