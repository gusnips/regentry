import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useConversationStore } from "./store";
import { Markdown } from "./Markdown";
import { toolVerbKey, toolHint } from "./tool-labels";
import type { Message } from "../types";
import { splitErrorDetail } from "../error-detail";
import { formatDuration } from "@/lib/format";
import { showReasoning } from "@/lib/prefs";
import { AddProviderDialog, useProvidersStore } from "@/modules/providers/ui";
import type { ProviderConfig } from "@/modules/providers/types";
import { Button } from "@/components/Button";

type HintKey = "badKey" | "quota" | "rateLimited" | "rejected" | "network" | "noProvider";
type CtaKey = "updateKey" | "checkUrl" | "addProvider";

const HINT_KEYS = {
  badKey: "chat.hint.badKey",
  quota: "chat.hint.quota",
  rateLimited: "chat.hint.rateLimited",
  rejected: "chat.hint.rejected",
  network: "chat.hint.network",
  noProvider: "chat.hint.noProvider",
} as const;

const CTA_KEYS = {
  updateKey: "chat.cta.updateKey",
  checkUrl: "chat.cta.checkUrl",
  addProvider: "chat.cta.addProvider",
} as const;

/**
 * Raw provider/agent error → likely-cause key + fix (house rule: never a bare error).
 * Regexes match the raw English provider text — provider errors arrive in English
 * regardless of UI locale. `cta` opens the provider setup dialog in place.
 */
function errorHint(message: string): { key: HintKey; cta?: CtaKey } | null {
  const m = message.toLowerCase();
  // Quota first: a 403/429 body that talks about billing is not a bad key, and
  // telling the user to re-enter a working key would send them the wrong way.
  if (/usage limit|quota|out of credit|insufficient (balance|credit|funds)|billing/.test(m))
    return { key: "quota", cta: "addProvider" };
  if (/401|403|unauthorized|forbidden|invalid api key|authentication/.test(m))
    return { key: "badKey", cta: "updateKey" };
  if (/429|rate limit/.test(m)) return { key: "rateLimited" };
  if (/400|invalid/.test(m)) return { key: "rejected" };
  if (/failed to fetch|networkerror|network/.test(m)) return { key: "network", cta: "checkUrl" };
  if (/no (active )?provider/.test(m)) return { key: "noProvider", cta: "addProvider" };
  return null;
}

function StepIcon({ msg }: { msg: Message }) {
  if (msg.live)
    return (
      <span
        role="status"
        className="h-2.5 w-2.5 shrink-0 animate-spin rounded-full border border-neutral-300 border-t-brand-500 dark:border-neutral-600 dark:border-t-brand-400"
      />
    );
  if (msg.ok === false) return <span className="text-red-500 dark:text-red-400">✗</span>;
  if (msg.ok === true) return <span className="text-neutral-400 dark:text-neutral-500">✓</span>;
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
  const expandable = !msg.live && Boolean(msg.detail || msg.images?.length);

  const line = (
    <>
      <StepIcon msg={msg} />
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
        {hint && msg.content && msg.ok !== false && <div>{msg.content}</div>}
        {msg.images?.map((src, i) => (
          <img
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
 * The agent's checklist. Collapsed it shows only the step in flight, which is
 * the one thing you want while it works; expanded it shows the whole route so
 * you can tell early that the agent misread the task and stop it.
 */
function PlanCard({ steps, current }: { steps: string[]; current: number }) {
  const { t } = useTranslation();
  const done = Math.min(current, steps.length);
  const active = steps[current];

  return (
    <details
      open={!active}
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
              {i < current ? "✓" : i === current ? "▪" : "○"}
            </span>
            <span>{step}</span>
          </li>
        ))}
      </ol>
    </details>
  );
}

/** The stored preference applies to every block; clicking a block toggles it. */
function useShowReasoning(): [boolean, (v: boolean) => void] {
  const [show, setShow] = useState(false);
  useEffect(() => {
    void showReasoning.get().then(setShow);
    return showReasoning.watch(setShow);
  }, []);
  return [show, (v) => void showReasoning.set(v)];
}

/**
 * Reasoning collapses to a one-line summary by default — a wall of tokens is
 * noise for most runs, and "Thought for 3m 48s" says everything that matters.
 * Clicking toggles the stored show-reasoning preference for all blocks.
 */
function ReasoningBlock({
  text,
  startedAt,
  elapsed,
}: {
  text: string;
  /** Present while the segment is still streaming. */
  startedAt?: number | null;
  /** Recorded duration once persisted. */
  elapsed?: number;
}) {
  const { t } = useTranslation();
  const [show, setShow] = useShowReasoning();
  const [now, setNow] = useState(() => Date.now());
  const live = startedAt != null;

  useEffect(() => {
    if (!live) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [live]);

  const duration = formatDuration(live ? now - (startedAt ?? now) : (elapsed ?? 0));

  return (
    <div className="max-w-[85%] self-start rounded-lg border border-neutral-200 px-3 py-1.5 text-xs text-neutral-500 dark:border-neutral-700 dark:text-neutral-400">
      <button
        type="button"
        aria-expanded={show}
        onClick={() => setShow(!show)}
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

function MessageBubble({
  msg,
  activeProvider,
  onRetry,
}: {
  msg: Message;
  activeProvider?: ProviderConfig;
  /** Present only on the newest error while idle — retry re-sends the same task. */
  onRetry?: () => void;
}) {
  const { t } = useTranslation();
  switch (msg.role) {
    case "user":
      return (
        <div className="flex max-w-[85%] flex-col gap-1.5 self-end rounded-lg bg-brand-600 px-3 py-2 text-sm break-words whitespace-pre-wrap text-white">
          {msg.images?.map((src, i) => (
            <img
              key={i}
              src={src}
              alt={t("chat.attachmentAlt", { number: i + 1 })}
              className="max-h-48 rounded border border-white/25 object-contain"
            />
          ))}
          {msg.content}
        </div>
      );
    case "assistant":
      return (
        <div className="max-w-[85%] self-start whitespace-pre-wrap break-words rounded-lg bg-neutral-100 px-3 py-2 text-sm text-neutral-900 dark:bg-neutral-800 dark:text-neutral-100">
          <Markdown>{msg.content}</Markdown>
        </div>
      );
    case "reasoning":
      return <ReasoningBlock text={msg.content} elapsed={msg.elapsed} />;
    case "step":
      return <StepRow msg={msg} />;
    case "plan":
      return msg.steps?.length ? <PlanCard steps={msg.steps} current={msg.current ?? 0} /> : null;
    case "error": {
      const hint = errorHint(msg.content);
      const { summary, detail } = splitErrorDetail(msg.content);
      return (
        <div className="max-w-[85%] self-start break-words rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-200">
          <div className="whitespace-pre-wrap">{summary}</div>
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
              <Button
                variant="ghost"
                size="sm"
                onClick={onRetry}
                className="text-red-700 hover:bg-red-100 dark:text-red-300 dark:hover:bg-red-900"
              >
                {t("chat.retry")}
              </Button>
            )}
            {hint?.cta && (
              <AddProviderDialog
                initialProvider={activeProvider}
                trigger={
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-red-700 hover:bg-red-100 dark:text-red-300 dark:hover:bg-red-900"
                  >
                    {t(CTA_KEYS[hint.cta])}
                  </Button>
                }
              />
            )}
          </div>
        </div>
      );
    }
  }
}

export function MessageList() {
  const { t } = useTranslation();
  const messages = useConversationStore((s) => s.messages);
  const streamingText = useConversationStore((s) => s.streamingText);
  const reasoningText = useConversationStore((s) => s.reasoningText);
  const reasoningStartedAt = useConversationStore((s) => s.reasoningStartedAt);
  const status = useConversationStore((s) => s.status);
  const lastRun = useConversationStore((s) => s.lastRun);
  const retry = useConversationStore((s) => s.retry);
  const activeProvider = useProvidersStore((s) => s.providers.find((p) => p.id === s.activeId));
  const containerRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  /**
   * Scroll follows the stream only while the user sits near the bottom.
   * Scrolling up unlocks (stick = false); the pill re-engages it.
   */
  const stickRef = useRef(true);
  const [stuck, setStuck] = useState(true);
  const hasLiveStep = messages.some((m) => m.live);

  const onScroll = () => {
    const el = containerRef.current;
    if (!el) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
    stickRef.current = atBottom;
    setStuck(atBottom);
  };

  const jumpToLatest = () => {
    stickRef.current = true;
    setStuck(true);
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(() => {
    if (stickRef.current) bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length]);

  useEffect(() => {
    if (stickRef.current) bottomRef.current?.scrollIntoView({ behavior: "instant" });
  }, [streamingText, reasoningText]);

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
    <div className="relative flex min-h-0 flex-1 flex-col">
      <div
        ref={containerRef}
        onScroll={onScroll}
        className="flex flex-1 flex-col gap-2 overflow-y-auto p-3"
      >
        {messages.map((m, i) => (
          <MessageBubble
            key={m.id}
            msg={m}
            activeProvider={activeProvider}
            onRetry={
              // Only the newest error offers Retry, and only once the run has settled.
              m.role === "error" && i === messages.length - 1 && status !== "running" && lastRun
                ? retry
                : undefined
            }
          />
        ))}
        {reasoningText && <ReasoningBlock text={reasoningText} startedAt={reasoningStartedAt} />}
        {streamingText && (
          <div className="max-w-[85%] self-start whitespace-pre-wrap break-words rounded-lg bg-neutral-100 px-3 py-2 text-sm text-neutral-900 dark:bg-neutral-800 dark:text-neutral-100">
            <Markdown>{streamingText}</Markdown>
            {status === "running" && <span className="animate-pulse">▊</span>}
          </div>
        )}
        {/* Dots cover the gaps only — a live tool row carries its own spinner. */}
        {status === "running" && !streamingText && !reasoningText && !hasLiveStep && (
          <div
            role="status"
            aria-label={t("chat.working")}
            className="flex items-center gap-1 self-start rounded-lg bg-neutral-100 px-3 py-2.5 dark:bg-neutral-800"
          >
            {[0, 150, 300].map((d) => (
              <span
                key={d}
                className="h-1.5 w-1.5 animate-bounce rounded-full bg-neutral-400 dark:bg-neutral-500"
                style={{ animationDelay: `${d}ms` }}
              />
            ))}
          </div>
        )}
        <div ref={bottomRef} />
      </div>
      {!stuck && (
        <Button
          variant="ghost"
          size="sm"
          onClick={jumpToLatest}
          className="absolute bottom-3 left-1/2 -translate-x-1/2 rounded-full border border-neutral-200 bg-white shadow-md hover:bg-neutral-50 dark:border-neutral-700 dark:bg-neutral-900 dark:hover:bg-neutral-800"
        >
          {t("chat.jumpToLatest")}
        </Button>
      )}
    </div>
  );
}
