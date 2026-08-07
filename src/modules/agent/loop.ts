import type { BrowserDriver } from "@/modules/browser";
import type { ChatProvider, ChatMessage, ToolCall, Delta } from "@/modules/providers/types";
import { isRetryable } from "@/modules/providers/types";
import { executeTool } from "./tools";
import { SYSTEM_PROMPT, buildUserPrompt, TOOL_DEFS } from "./prompt";

const MAX_STEPS = 50;
/** Transient stream failures are retried in place this many times before surfacing. */
const MAX_STREAM_ATTEMPTS = 3;
const BASE_BACKOFF_MS = 1000;
const MAX_BACKOFF_MS = 15_000;

export interface LoopCallbacks {
  onToken?: (text: string) => void;
  onStep?: (tool: string, summary: string, ok?: boolean) => void;
  onUsage?: (input: number, output: number) => void;
  onError?: (message: string) => void;
  onDone?: (summary?: string) => void;
}

export interface LoopOptions {
  provider: ChatProvider;
  driver: BrowserDriver;
  task: string;
  signal: AbortSignal;
  callbacks: LoopCallbacks;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Full-jitter exponential backoff: random delay in [0, min(cap, base·2^(attempt-1))]. */
function backoffMs(attempt: number): number {
  const ceiling = Math.min(MAX_BACKOFF_MS, BASE_BACKOFF_MS * 2 ** (attempt - 1));
  return Math.floor(Math.random() * ceiling);
}

interface TurnResult {
  text: string;
  toolCalls: ToolCall[];
  truncated: boolean;
}

/**
 * Stream one model turn. A transient failure (network blip, 429, 5xx) is retried in place
 * with backoff, but ONLY while nothing has been emitted yet this turn — so the UI never
 * sees a replayed token. The partial turn is never committed to `messages`, so a retry
 * restarts cleanly.
 */
async function streamTurn(
  provider: ChatProvider,
  messages: ChatMessage[],
  signal: AbortSignal,
  callbacks: LoopCallbacks,
): Promise<TurnResult> {
  for (let attempt = 1; ; attempt++) {
    let text = "";
    const toolCalls: ToolCall[] = [];
    let emitted = false;
    let truncated = false;

    try {
      for await (const delta of provider.stream(messages, TOOL_DEFS, signal)) {
        if (delta.type === "error") throw new Error(delta.message);
        const handled = handleDelta(delta, callbacks, toolCalls);
        if (handled) {
          text += handled;
          emitted = true;
        }
        if (delta.type === "tool_use") emitted = true;
        if (delta.type === "usage") callbacks.onUsage?.(delta.input, delta.output);
        if (delta.type === "finish" && delta.reason === "length") truncated = true;
      }
      return { text, toolCalls, truncated };
    } catch (e) {
      if (signal.aborted) throw e;
      const canRetry = !emitted && attempt < MAX_STREAM_ATTEMPTS && isRetryable(e);
      if (!canRetry) throw e;
      callbacks.onStep?.(
        "retry",
        `Connection hiccup — retrying (${attempt}/${MAX_STREAM_ATTEMPTS - 1})`,
      );
      await sleep(backoffMs(attempt));
    }
  }
}

/**
 * Agent loop: snapshot → prompt → stream → execute tools → repeat until done or max steps.
 */
export async function runAgentLoop(opts: LoopOptions): Promise<void> {
  const { provider, driver, task, signal, callbacks } = opts;

  // Auto-snapshot merged into the task message — Anthropic rejects consecutive user messages
  const initial = await driver.snapshot();
  const messages: ChatMessage[] = [
    { role: "system", content: SYSTEM_PROMPT },
    {
      role: "user",
      content: `${buildUserPrompt(task)}\n\nCurrent page:\n${initial.pageContent}`,
    },
  ];

  for (let step = 0; step < MAX_STEPS; step++) {
    if (signal.aborted) {
      callbacks.onDone?.();
      return;
    }

    // Step-budget finalize: on the last step, force a best-effort answer instead
    // of dying with "did not complete" (featury engine pattern)
    const finalizing = step === MAX_STEPS - 1;
    if (finalizing) {
      messages.push({
        role: "user",
        content:
          "You have reached your step budget. Call done now with your best summary of what you accomplished, based only on what you have already gathered. Do not call any other tool.",
      });
    }

    let turn: TurnResult;
    try {
      turn = await streamTurn(provider, messages, signal, callbacks);
    } catch (e) {
      if (signal.aborted) {
        callbacks.onDone?.();
        return;
      }
      const msg = e instanceof Error ? e.message : String(e);
      callbacks.onError?.(`Provider error: ${msg}`);
      return;
    }

    if (turn.truncated) {
      callbacks.onStep?.(
        "warn",
        "Model hit its output limit mid-response — answer may be incomplete",
      );
    }

    messages.push({
      role: "assistant",
      content: turn.text,
      toolCalls: turn.toolCalls.length > 0 ? turn.toolCalls : undefined,
    });

    if (turn.toolCalls.length === 0) {
      // Model responded with text only — nudge it to use tools
      messages.push({
        role: "user",
        content:
          "Use a tool to make progress on the task. Call snapshot if you need to see the page.",
      });
      continue;
    }

    // Execute each tool call
    let taskDone = false;
    const results: { id: string; content: string }[] = [];

    for (const call of turn.toolCalls) {
      if (signal.aborted) {
        callbacks.onDone?.();
        return;
      }

      const result = await executeTool(call, driver);

      callbacks.onStep?.(
        call.name,
        result.ok ? formatSuccessSummary(call.name, result.data) : `Failed: ${result.error}`,
        result.ok,
      );

      if (call.name === "done") {
        taskDone = true;
        const summary = (result.data as { summary?: string })?.summary ?? "Task complete";
        callbacks.onDone?.(summary);
      } else {
        results.push({
          id: call.id,
          content: JSON.stringify(result.ok ? result.data : { error: result.error }),
        });
      }
    }

    // Feed results back as ONE message — Anthropic requires all tool_results
    // for a turn in a single user message; OpenAI adapter expands to N messages.
    if (results.length > 0) {
      messages.push({ role: "tool_results", content: "", toolResults: results });
    }

    if (taskDone) return;
  }

  // Unreachable in practice — the finalize nudge fires on the last step — but if the
  // model ignored it, close out gracefully instead of hanging.
  callbacks.onDone?.("Step budget exhausted");
}

function handleDelta(delta: Delta, callbacks: LoopCallbacks, toolCalls: ToolCall[]): string | null {
  switch (delta.type) {
    case "text":
      callbacks.onToken?.(delta.text);
      return delta.text;
    case "tool_use":
      toolCalls.push({ id: delta.id, name: delta.name, args: delta.args });
      return null;
    case "done":
    case "usage":
    case "finish":
    case "error":
      return null;
  }
}

function formatSuccessSummary(tool: string, data: unknown): string {
  if (tool === "snapshot" && data && typeof data === "object") {
    const snap = data as { pageContent?: string };
    const lines = snap.pageContent?.split("\n").length ?? 0;
    return `Captured ${lines} elements`;
  }
  if (tool === "click" && data && typeof data === "object") {
    const pos = data as { x: number; y: number };
    return `Clicked at (${pos.x}, ${pos.y})`;
  }
  if (tool === "press_key") {
    return "Key pressed";
  }
  if (tool === "navigate") {
    return "Navigated successfully";
  }
  return `${tool} completed`;
}
