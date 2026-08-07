import { useEffect, useRef } from "react";
import { useConversationStore } from "./store";
import type { Message } from "../types";

function MessageBubble({ msg }: { msg: Message }) {
  switch (msg.role) {
    case "user":
      return (
        <div className="self-end max-w-[85%] rounded-lg bg-blue-600 px-3 py-2 text-sm text-white">
          {msg.content}
        </div>
      );
    case "assistant":
      return (
        <div className="self-start max-w-[85%] rounded-lg bg-neutral-100 px-3 py-2 text-sm text-neutral-900 whitespace-pre-wrap">
          {msg.content}
        </div>
      );
    case "step":
      return (
        <div className="self-center rounded bg-neutral-50 px-2 py-1 text-xs text-neutral-500 border border-neutral-200">
          ⚙ {msg.tool}: {msg.content}
        </div>
      );
    case "error":
      return (
        <div className="self-start max-w-[85%] rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800 border border-red-200">
          {msg.content}
        </div>
      );
  }
}

export function MessageList() {
  const messages = useConversationStore((s) => s.messages);
  const streamingText = useConversationStore((s) => s.streamingText);
  const status = useConversationStore((s) => s.status);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length, streamingText]);

  if (messages.length === 0 && !streamingText) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-2 p-6 text-center">
        <div className="text-sm font-medium text-neutral-700">What should I do?</div>
        <p className="text-xs text-neutral-500 max-w-[240px]">
          Describe a task and I'll drive this browser tab — navigate, read pages, click, type.
          Uses your existing logins.
        </p>
        <p className="text-xs text-neutral-400 mt-2">
          Example: "go to news.ycombinator.com and summarize the top 3 headlines"
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col gap-2 overflow-y-auto p-3">
      {messages.map((m) => (
        <MessageBubble key={m.id} msg={m} />
      ))}
      {streamingText && (
        <div className="self-start max-w-[85%] rounded-lg bg-neutral-100 px-3 py-2 text-sm text-neutral-900 whitespace-pre-wrap">
          {streamingText}
          {status === "running" && <span className="animate-pulse">▊</span>}
        </div>
      )}
      <div ref={bottomRef} />
    </div>
  );
}
