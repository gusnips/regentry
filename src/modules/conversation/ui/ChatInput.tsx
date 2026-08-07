import { useState } from "react";
import type { KeyboardEvent } from "react";
import { useConversationStore } from "./store";

export function ChatInput() {
  const [text, setText] = useState("");
  const status = useConversationStore((s) => s.status);
  const sendTask = useConversationStore((s) => s.sendTask);
  const stop = useConversationStore((s) => s.stop);

  const running = status === "running";

  const submit = () => {
    const task = text.trim();
    if (!task || running) return;
    sendTask(task);
    setText("");
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      submit();
    }
  };

  return (
    <div className="flex items-end gap-2 border-t border-neutral-200 p-3">
      <textarea
        className="flex-1 resize-none rounded-lg border border-neutral-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
        rows={2}
        placeholder="Describe a task… (Enter to send, Shift+Enter for newline)"
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={onKeyDown}
        disabled={running}
      />
      {running ? (
        <button
          className="rounded-lg bg-red-600 px-3 py-2 text-sm font-medium text-white hover:bg-red-700"
          onClick={stop}
        >
          Stop
        </button>
      ) : (
        <button
          className="rounded-lg bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-40"
          onClick={submit}
          disabled={!text.trim()}
        >
          Send
        </button>
      )}
    </div>
  );
}
