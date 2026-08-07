import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useConversationStore } from "./store";
import { toolVerbKey } from "./tool-labels";

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
  const { t } = useTranslation();
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
  const idleVerbs = t("run.idle", { returnObjects: true });
  const lastStep = [...messages].reverse().find((m) => m.role === "step");
  const toolKey = toolVerbKey(lastStep?.tool);
  const verb = toolKey ? t(toolKey) : (idleVerbs[verbIdx % idleVerbs.length] ?? idleVerbs[0] ?? "");

  const totalTokens = usage.input + usage.output;

  return (
    <div className="flex items-center gap-2 border-t border-neutral-100 px-3 py-1.5 text-xs text-neutral-500 dark:border-neutral-800 dark:text-neutral-400">
      <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-brand-500" />
      <span className="font-medium text-neutral-700 dark:text-neutral-200">{verb}…</span>
      <span className="text-neutral-400 dark:text-neutral-500">
        {formatElapsed(now - runStartedAt)}
        {totalTokens > 0 && ` · ${t("run.tokens", { count: formatTokens(totalTokens) })}`}
      </span>
    </div>
  );
}
