import type { BrowserDriver } from "@/modules/browser";
import type { ChatProvider, ChatMessage, ToolCall, Delta } from "@/modules/providers/types";
import { executeTool } from "./tools";
import { SYSTEM_PROMPT, buildUserPrompt, TOOL_DEFS } from "./prompt";

const MAX_STEPS = 50;

export interface LoopCallbacks {
  onToken?: (text: string) => void;
  onStep?: (tool: string, summary: string) => void;
  onToolCall?: (tool: string, args: Record<string, unknown>) => void;
  onToolResult?: (tool: string, ok: boolean, detail?: string) => void;
  onError?: (message: string) => void;
  onDone?: (summary: string) => void;
}

export interface LoopOptions {
  provider: ChatProvider;
  driver: BrowserDriver;
  task: string;
  signal: AbortSignal;
  callbacks: LoopCallbacks;
  model?: string;
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
      callbacks.onError?.("Task aborted by user");
      return;
    }

    // Stream the model response
    let assistantContent = "";
    const toolCalls: ToolCall[] = [];

    try {
      for await (const delta of provider.stream(messages, TOOL_DEFS, signal)) {
        const handled = handleDelta(delta, callbacks, toolCalls);
        if (handled) assistantContent += handled;
        if (delta.type === "error") {
          callbacks.onError?.(delta.message);
          return;
        }
      }
    } catch (e) {
      if (signal.aborted) {
        callbacks.onError?.("Task aborted by user");
        return;
      }
      const msg = e instanceof Error ? e.message : String(e);
      callbacks.onError?.(`Provider error: ${msg}`);
      return;
    }

    // Record assistant response
    messages.push({
      role: "assistant",
      content: assistantContent,
      toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
    });

    if (toolCalls.length === 0) {
      // Model responded with text only — nudge it to use tools
      messages.push({
        role: "user",
        content: "Use a tool to make progress on the task. Call snapshot if you need to see the page.",
      });
      continue;
    }

    // Execute each tool call
    let taskDone = false;
    const results: { id: string; content: string }[] = [];

    for (const call of toolCalls) {
      if (signal.aborted) {
        callbacks.onError?.("Task aborted by user");
        return;
      }

      callbacks.onToolCall?.(call.name, call.args);

      const result = await executeTool(call, driver);
      callbacks.onToolResult?.(call.name, result.ok, result.error);

      callbacks.onStep?.(
        call.name,
        result.ok
          ? formatSuccessSummary(call.name, result.data)
          : `Failed: ${result.error}`,
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

  callbacks.onError?.(`Task did not complete within ${MAX_STEPS} steps`);
}

function handleDelta(
  delta: Delta,
  callbacks: LoopCallbacks,
  toolCalls: ToolCall[],
): string | null {
  switch (delta.type) {
    case "text":
      callbacks.onToken?.(delta.text);
      return delta.text;
    case "tool_use":
      toolCalls.push({ id: delta.id, name: delta.name, args: delta.args });
      return null;
    case "done":
      return null;
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
  if (tool === "navigate") {
    return "Navigated successfully";
  }
  return `${tool} completed`;
}
