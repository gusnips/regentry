import { useEffect, useRef, useState } from "react";
import type { KeyboardEvent } from "react";
import { useConversationStore } from "./store";
import { TextArea } from "@/components/TextArea";
import { Button } from "@/components/Button";

export function ChatInput() {
  const [text, setText] = useState("");
  const status = useConversationStore((s) => s.status);
  const sendTask = useConversationStore((s) => s.sendTask);
  const stop = useConversationStore((s) => s.stop);
  const areaRef = useRef<HTMLTextAreaElement>(null);

  const running = status === "running";

  // Autogrow with content, capped at ~6 rows
  useEffect(() => {
    const el = areaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 132)}px`;
  }, [text]);

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
      <TextArea
        ref={areaRef}
        className="flex-1"
        rows={2}
        autoFocus
        aria-label="Task description"
        placeholder="Describe a task… (Enter to send, Shift+Enter for newline)"
        title={running ? "A run is in flight — stop it to send a new task" : undefined}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={onKeyDown}
        disabled={running}
      />
      {running ? (
        <Button variant="danger" onClick={stop}>
          Stop
        </Button>
      ) : (
        <Button onClick={submit} disabled={!text.trim()}>
          Send
        </Button>
      )}
    </div>
  );
}
