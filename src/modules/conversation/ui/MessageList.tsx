import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useConversationStore } from "./store";
import { Markdown } from "./Markdown";
import { toolVerbKey } from "./tool-labels";
import type { Message } from "../types";
import { splitErrorDetail } from "../error-detail";
import { AddProviderDialog, useProvidersStore } from "@/modules/providers/ui";
import type { ProviderConfig } from "@/modules/providers/types";
import { Button } from "@/components/Button";

type HintKey = "badKey" | "rateLimited" | "rejected" | "network" | "noProvider";
type CtaKey = "updateKey" | "checkUrl" | "addProvider";

const HINT_KEYS = {
  badKey: "chat.hint.badKey",
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
  if (/401|403|unauthorized|forbidden|invalid api key|authentication/.test(m))
    return { key: "badKey", cta: "updateKey" };
  if (/429|rate limit/.test(m)) return { key: "rateLimited" };
  if (/400|invalid/.test(m)) return { key: "rejected" };
  if (/failed to fetch|networkerror|network/.test(m)) return { key: "network", cta: "checkUrl" };
  if (/no (active )?provider/.test(m)) return { key: "noProvider", cta: "addProvider" };
  return null;
}

function StepRow({ msg }: { msg: Message }) {
  const { t } = useTranslation();
  const key = toolVerbKey(msg.tool);
  const label = key ? t(key) : msg.tool;
  return (
    <div className="flex items-center gap-1.5 self-start px-1 text-xs text-neutral-500 dark:text-neutral-400">
      {msg.live ? (
        <span
          role="status"
          className="h-2.5 w-2.5 shrink-0 animate-spin rounded-full border border-neutral-300 border-t-brand-500 dark:border-neutral-600 dark:border-t-brand-400"
        />
      ) : msg.ok === false ? (
        <span className="text-red-500 dark:text-red-400">✗</span>
      ) : msg.ok === true ? (
        <span className="text-neutral-400 dark:text-neutral-500">✓</span>
      ) : (
        <span className="text-neutral-300 dark:text-neutral-600">•</span>
      )}
      <span className="font-medium">{label}</span>
      {!msg.live && <span className="truncate">{msg.content}</span>}
    </div>
  );
}

/** Model reasoning — muted, collapsed once persisted, expanded while streaming. */
function ReasoningBlock({ text, label, open }: { text: string; label: string; open?: boolean }) {
  return (
    <details
      open={open}
      className="group max-w-[85%] self-start rounded-lg border border-neutral-200 px-3 py-1.5 text-xs text-neutral-500 dark:border-neutral-700 dark:text-neutral-400"
    >
      <summary className="cursor-pointer list-none font-medium select-none hover:text-neutral-700 dark:hover:text-neutral-300">
        <span className="mr-1 inline-block transition-transform group-open:rotate-90">▸</span>
        {label}
      </summary>
      <div className="mt-1 break-words whitespace-pre-wrap">{text}</div>
    </details>
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
        <div className="max-w-[85%] self-end whitespace-pre-wrap break-words rounded-lg bg-brand-600 px-3 py-2 text-sm text-white">
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
      return <ReasoningBlock text={msg.content} label={t("chat.thinking")} />;
    case "step":
      return <StepRow msg={msg} />;
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
  const status = useConversationStore((s) => s.status);
  const lastTask = useConversationStore((s) => s.lastTask);
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
              m.role === "error" && i === messages.length - 1 && status !== "running" && lastTask
                ? retry
                : undefined
            }
          />
        ))}
        {reasoningText && <ReasoningBlock open text={reasoningText} label={t("chat.thinking")} />}
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
