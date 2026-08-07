import { useEffect, useState } from "react";
import { useConversationStore } from "./store";

/** Per-tool gerunds for the active-step verb, Claude Code spinner style. */
const TOOL_VERBS: Record<string, string> = {
  navigate: "Navigating",
  snapshot: "Reading page",
  click: "Clicking",
  type: "Typing",
  press_key: "Pressing keys",
  scroll_down: "Scrolling",
  scroll_up: "Scrolling",
  screenshot: "Capturing",
  done: "Wrapping up",
  retry: "Retrying",
  warn: "Working",
  interrupted: "Stopped",
};

/** Generic verbs while the model streams between tool calls. */
const IDLE_VERBS = ["Thinking", "Working", "Pondering", "Reasoning", "Contemplating"];

function formatElapsed(ms: number): string {
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  return `${m}m ${s % 60}s`;
}

function formatTokens(n: number): string {
  return n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n);
}

export function RunStatus() {
  const status = useConversationStore((s) => s.status);
  const runStartedAt = useConversationStore((s) => s.runStartedAt);
  const usage = useConversationStore((s) => s.usage);
  const messages = useConversationStore((s) => s.messages);

  const [now, setNow] = useState(() => Date.now());
  const [verbIdx, setVerbIdx] = useState(0);

  const running = status === "running" && runStartedAt !== null;

  useEffect(() => {
    if (!running) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    const verbTimer = setInterval(() => setVerbIdx((i) => i + 1), 2500);
    return () => {
      clearInterval(timer);
      clearInterval(verbTimer);
    };
  }, [running]);

  if (!running) return null;

  // Verb: from the latest step's tool, else rotate generic gerunds
  const lastStep = [...messages].reverse().find((m) => m.role === "step");
  const verb =
    (lastStep?.tool && TOOL_VERBS[lastStep.tool]) ?? IDLE_VERBS[verbIdx % IDLE_VERBS.length];

  const totalTokens = usage.input + usage.output;

  return (
    <div className="flex items-center gap-2 border-t border-neutral-100 px-3 py-1.5 text-xs text-neutral-500">
      <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-brand-500" />
      <span className="font-medium text-neutral-700">{verb}…</span>
      <span className="text-neutral-400">
        {formatElapsed(now - runStartedAt)}
        {totalTokens > 0 && ` · ${formatTokens(totalTokens)} tokens`}
      </span>
    </div>
  );
}
