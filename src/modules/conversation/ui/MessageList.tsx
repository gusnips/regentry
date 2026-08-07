import { useEffect, useRef } from "react";
import { useConversationStore } from "./store";
import type { Message } from "../types";
import { Button } from "@/components/Button";

/** Raw provider/agent error → likely cause + fix (house rule: never a bare error). */
function errorHint(message: string): { text: string; openSettings?: boolean } | null {
  const m = message.toLowerCase();
  if (/401|403|unauthorized|forbidden|invalid api key|authentication/.test(m))
    return { text: "Likely a bad or missing API key — check it in Settings.", openSettings: true };
  if (/429|rate limit/.test(m)) return { text: "Rate limited — wait a moment, then send again." };
  if (/400|invalid/.test(m))
    return {
      text: "The provider rejected the request — often an unsupported model or reasoning effort level. The detail above says which.",
    };
  if (/failed to fetch|networkerror|network/.test(m))
    return {
      text: "Couldn't reach the provider — check the base URL and your connection.",
      openSettings: true,
    };
  if (/no (active )?provider/.test(m))
    return { text: "Pick or add one — it takes a minute.", openSettings: true };
  return null;
}

function StepRow({ msg }: { msg: Message }) {
  return (
    <div className="flex items-center gap-1.5 self-start px-1 text-xs text-neutral-500 dark:text-neutral-400">
      {msg.ok === false ? (
        <span className="text-red-500 dark:text-red-400">✗</span>
      ) : msg.ok === true ? (
        <span className="text-neutral-400 dark:text-neutral-500">✓</span>
      ) : (
        <span className="text-neutral-300 dark:text-neutral-600">•</span>
      )}
      <span className="font-medium">{msg.tool}</span>
      <span className="truncate">{msg.content}</span>
    </div>
  );
}

function MessageBubble({ msg }: { msg: Message }) {
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
          {msg.content}
        </div>
      );
    case "step":
      return <StepRow msg={msg} />;
    case "error": {
      const hint = errorHint(msg.content);
      return (
        <div className="max-w-[85%] self-start break-words rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-200">
          <div className="whitespace-pre-wrap">{msg.content}</div>
          {hint && <div className="mt-1 text-xs text-red-600 dark:text-red-400">{hint.text}</div>}
          {hint?.openSettings && (
            <Button
              variant="ghost"
              size="sm"
              className="mt-1 -ml-2 text-red-700 hover:bg-red-100 dark:text-red-300 dark:hover:bg-red-900"
              onClick={() => chrome.runtime.openOptionsPage()}
            >
              Open Settings →
            </Button>
          )}
        </div>
      );
    }
  }
}

export function MessageList() {
  const messages = useConversationStore((s) => s.messages);
  const streamingText = useConversationStore((s) => s.streamingText);
  const status = useConversationStore((s) => s.status);
  const containerRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  /** Auto-scroll only while the user is already near the bottom. */
  const stickRef = useRef(true);

  const onScroll = () => {
    const el = containerRef.current;
    if (el) stickRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
  };

  useEffect(() => {
    if (stickRef.current) bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length]);

  useEffect(() => {
    if (stickRef.current) bottomRef.current?.scrollIntoView({ behavior: "instant" });
  }, [streamingText]);

  if (messages.length === 0 && !streamingText) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-2 p-6 text-center">
        <div className="text-sm font-medium text-neutral-700 dark:text-neutral-200">
          What should I do?
        </div>
        <p className="max-w-[240px] text-xs text-neutral-500 dark:text-neutral-400">
          Describe a task and I'll drive this browser tab — navigate, read pages, click, type. Uses
          your existing logins.
        </p>
        <p className="mt-2 text-xs text-neutral-400 dark:text-neutral-500">
          Example: "go to news.ycombinator.com and summarize the top 3 headlines"
        </p>
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      onScroll={onScroll}
      className="flex flex-1 flex-col gap-2 overflow-y-auto p-3"
    >
      {messages.map((m) => (
        <MessageBubble key={m.id} msg={m} />
      ))}
      {streamingText && (
        <div className="max-w-[85%] self-start whitespace-pre-wrap break-words rounded-lg bg-neutral-100 px-3 py-2 text-sm text-neutral-900 dark:bg-neutral-800 dark:text-neutral-100">
          {streamingText}
          {status === "running" && <span className="animate-pulse">▊</span>}
        </div>
      )}
      <div ref={bottomRef} />
    </div>
  );
}
