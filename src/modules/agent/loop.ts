import type { BrowserDriver } from "@/modules/browser";
import type {
  ChatProvider,
  ChatMessage,
  ToolCall,
  Delta,
  ToolResult as ProviderToolResult,
} from "@/modules/providers/types";
import { isRetryable } from "@/modules/providers/types";
import type { StepPayload, PlanPayload } from "@/shared/protocol";
import { createLogger, truncate } from "@/lib/logger";
import { i18n, currentLanguageName } from "@/i18n";
import { loadAgentContext } from "@/modules/memory";
import type { ToolDef } from "@/modules/providers/types";
import { executeTool } from "./tools";
import type { ToolResult } from "./tools";
import { buildSystemPrompt, buildTaskMessage, buildToolDefs, type PreviousTab } from "./prompt";

const log = createLogger("agent");

const MAX_STEPS = 50;
/** Transient stream failures are retried in place this many times before surfacing. */
const MAX_STREAM_ATTEMPTS = 3;
const BASE_BACKOFF_MS = 1000;
const MAX_BACKOFF_MS = 15_000;
/** Result payload kept for the panel's expandable step row — a page snapshot is far larger. */
const MAX_DETAIL = 2000;
/**
 * Images are the most expensive thing in a request body: every one is re-sent on
 * every later turn, so an unbounded run would grow quadratically. Only the newest
 * screenshots stay attached; their text results carry the rest of the history.
 *
 * ponytail: a fixed count, not a token budget. The ceiling is that a model
 * comparing four screenshots can only see the last two — it must re-capture.
 * Upgrade path is trimming against the model's real context window.
 */
const MAX_ATTACHED_IMAGES = 2;

export interface LoopCallbacks {
  onToken?: (text: string) => void;
  onReasoning?: (text: string) => void;
  onStepStart?: (tool: string, args: Record<string, unknown>) => void;
  /** Wire shape lives in shared/protocol — producer and panel share one definition. */
  onStep?: (step: StepPayload) => void;
  onPlan?: (plan: PlanPayload) => void;
  /** A queued mid-run message was consumed — the panel turns its pending line into a real one. */
  onInjected?: (id: string, text: string) => void;
  onUsage?: (input: number, output: number) => void;
  onError?: (message: string) => void;
  onDone?: (summary?: string) => void;
  /** The run ended on a question for the user — not on error and not on done. */
  onAskUser?: (question: string) => void;
}

export interface LoopOptions {
  provider: ChatProvider;
  driver: BrowserDriver;
  task: string;
  /** Data-URL images the user attached to the task, referenced in the text as "[Image #1]". */
  images?: string[];
  /**
   * The tabs the conversation's earlier runs drove — set only for ones this run
   * is not on, so a continuation typed elsewhere can still find its way back.
   */
  previousTabs?: PreviousTab[];
  /**
   * The stored conversation as alternating user/assistant turns, replayed
   * between the system prompt and the fresh task so a continuation lands on a
   * model that has read the same exchange. The adapters serialize it with the
   * same code path as this run's own turns.
   */
  history?: ChatMessage[];
  /**
   * Messages the user typed mid-run, drained at each tool boundary. Inserting
   * them between tool batches (not mid-stream) keeps every provider wire valid
   * and lands them in the conversation exactly where the user meant them.
   */
  drainInjected?: () => { id: string; text: string }[];
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
  reasoning: string;
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
  tools: ToolDef[],
  signal: AbortSignal,
  callbacks: LoopCallbacks,
): Promise<TurnResult> {
  for (let attempt = 1; ; attempt++) {
    let text = "";
    let reasoning = "";
    const toolCalls: ToolCall[] = [];
    let emitted = false;
    let truncated = false;

    try {
      for await (const delta of provider.stream(messages, tools, signal)) {
        const handled = handleDelta(delta, callbacks, toolCalls);
        if (handled) {
          text += handled;
          emitted = true;
        }
        // Committed for provider echo (ChatMessage.reasoning) — display happens in handleDelta.
        if (delta.type === "reasoning") reasoning += delta.text;
        if (delta.type === "tool_use") emitted = true;
        if (delta.type === "usage") callbacks.onUsage?.(delta.input, delta.output);
        if (delta.type === "finish" && delta.reason === "length") truncated = true;
      }
      return { text, reasoning, toolCalls, truncated };
    } catch (e) {
      if (signal.aborted) throw e;
      const canRetry = !emitted && attempt < MAX_STREAM_ATTEMPTS && isRetryable(e);
      if (!canRetry) throw e;
      const reason = e instanceof Error ? e.message : String(e);
      log.warn(
        `stream failed before any output — retrying (${attempt}/${MAX_STREAM_ATTEMPTS - 1}):`,
        reason,
      );
      callbacks.onStep?.({
        tool: "retry",
        summary: i18n.t("errors.retrying", { attempt, max: MAX_STREAM_ATTEMPTS - 1 }),
        detail: reason,
      });
      await sleep(backoffMs(attempt));
    }
  }
}

/**
 * Agent loop: snapshot → prompt → stream → execute tools → repeat until done or max steps.
 */
export async function runAgentLoop(opts: LoopOptions): Promise<ChatMessage[]> {
  const {
    provider,
    driver,
    task,
    images,
    previousTabs,
    history,
    drainInjected,
    signal,
    callbacks,
  } = opts;
  log.info("run started:", truncate(task, 120));

  // AGENTS.md / MEMORY.md are read once, here: a run keeps the context it started
  // with, so editing a doc mid-run never rewrites the instructions under the model.
  // The snapshot is independent of the docs — both run concurrently.
  const [context, initial] = await Promise.all([loadAgentContext(), driver.snapshot()]);
  const tools = buildToolDefs(context.memoryOn);

  // Auto-snapshot merged into the task message — Anthropic rejects consecutive user messages
  const messages: ChatMessage[] = [
    { role: "system", content: buildSystemPrompt(context, currentLanguageName()) },
    ...(history ?? []),
    {
      role: "user",
      content: buildTaskMessage(task, initial.pageContent, previousTabs),
      // The user's own attachments are the subject of the task — unlike screenshots
      // they are never pruned, or a long run would forget what it was asked about.
      ...(images?.length ? { images } : {}),
    },
  ];

  for (let step = 0; step < MAX_STEPS; step++) {
    if (signal.aborted) {
      callbacks.onDone?.();
      return messages;
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
      turn = await streamTurn(provider, messages, tools, signal, callbacks);
    } catch (e) {
      if (signal.aborted) {
        callbacks.onDone?.();
        return messages;
      }
      const msg = e instanceof Error ? e.message : String(e);
      log.error(`run failed at step ${step + 1}:`, msg);
      callbacks.onError?.(i18n.t("errors.providerError", { message: msg }));
      return messages;
    }

    log.debug(`step ${step + 1}`, {
      tools: turn.toolCalls.map((t) => t.name),
      textChars: turn.text.length,
      truncated: turn.truncated,
    });

    if (turn.truncated) {
      callbacks.onStep?.({ tool: "warn", summary: i18n.t("errors.outputLimit") });
    }

    messages.push({
      role: "assistant",
      content: turn.text,
      // Echoed back on later turns — DeepSeek's thinking mode 400s without it.
      ...(turn.reasoning ? { reasoning: turn.reasoning } : {}),
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
    const results: ProviderToolResult[] = [];

    for (const call of turn.toolCalls) {
      if (signal.aborted) {
        callbacks.onDone?.();
        return messages;
      }

      // The plan is bookkeeping, not an action on the page: it replaces a card
      // rather than adding a row, so it gets no spinner and no step of its own.
      const bookkeeping = call.name === "plan";
      if (!bookkeeping) callbacks.onStepStart?.(call.name, call.args);
      const result = await executeTool(call, driver);
      if (!result.ok) log.warn(`tool ${call.name} failed:`, result.error);

      if (bookkeeping && result.ok) {
        callbacks.onPlan?.(result.data as PlanPayload);
      } else {
        callbacks.onStep?.({
          tool: call.name,
          summary: result.ok
            ? formatSuccessSummary(call.name, result.data)
            : i18n.t("errors.failed", { error: result.error }),
          ok: result.ok,
          args: call.args,
          detail: formatDetail(call.name, result),
          images: result.images,
        });
      }

      if (call.name === "done") {
        taskDone = true;
        const summary =
          (result.data as { summary?: string })?.summary ?? i18n.t("errors.taskComplete");
        log.info(`run done after step ${step + 1}:`, truncate(summary, 120));
        callbacks.onDone?.(summary);
      } else if (call.name === "ask_user") {
        // The question closes the run: the panel renders it as a card and the
        // answer arrives as the next message, with this run replayed as history.
        taskDone = true;
        log.info("run paused on ask_user after step", step + 1);
        callbacks.onAskUser?.((call.args.question as string) ?? "");
        callbacks.onDone?.();
      } else {
        results.push({
          id: call.id,
          content: JSON.stringify(result.ok ? result.data : { error: result.error }),
          ...(result.images?.length ? { images: result.images } : {}),
        });
      }
    }

    // Feed results back as ONE message — Anthropic requires all tool_results
    // for a turn in a single user message; OpenAI adapter expands to N messages.
    if (results.length > 0) {
      messages.push({ role: "tool_results", content: "", toolResults: results });
      pruneImages(messages);
    }

    // Queued mid-run messages join here, after the tool results they comment on.
    // A run that ends on `done` leaves its queue unconsumed — the panel recalls it.
    for (const item of drainInjected?.() ?? []) {
      log.info("injected mid-run message:", truncate(item.text, 120));
      messages.push({ role: "user", content: item.text });
      callbacks.onInjected?.(item.id, item.text);
    }

    if (taskDone) return messages;
  }

  // Unreachable in practice — the finalize nudge fires on the last step — but if the
  // model ignored it, close out gracefully instead of hanging.
  callbacks.onDone?.(i18n.t("errors.stepBudgetExhausted"));
  return messages;
}

function handleDelta(delta: Delta, callbacks: LoopCallbacks, toolCalls: ToolCall[]): string | null {
  switch (delta.type) {
    case "text":
      callbacks.onToken?.(delta.text);
      return delta.text;
    case "reasoning":
      // Display-only — never joins the committed turn text.
      callbacks.onReasoning?.(delta.text);
      return null;
    case "tool_use":
      toolCalls.push({ id: delta.id, name: delta.name, args: delta.args });
      return null;
    case "done":
    case "usage":
    case "finish":
      return null;
  }
}

/**
 * Drop every screenshot but the newest few, oldest first. Only tool results are
 * pruned — a user's own attachment is what the task is about and always stays.
 */
function pruneImages(messages: ChatMessage[]): void {
  let budget = MAX_ATTACHED_IMAGES;
  for (let i = messages.length - 1; i >= 0; i--) {
    for (const result of messages[i]?.toolResults ?? []) {
      if (!result.images?.length) continue;
      if (budget > 0) budget -= result.images.length;
      else delete result.images;
    }
  }
}

/** Result payload for the panel's expandable row — bounded, never a whole page. */
function formatDetail(tool: string, result: ToolResult): string | undefined {
  if (!result.ok) return result.error;
  if (tool === "snapshot") {
    const snapshot = result.data as { pageContent?: string } | undefined;
    return snapshot?.pageContent ? truncate(snapshot.pageContent, MAX_DETAIL) : undefined;
  }
  if (result.data === undefined) return undefined;
  const json = JSON.stringify(result.data, null, 2);
  return json && json !== "{}" ? truncate(json, MAX_DETAIL) : undefined;
}

function formatSuccessSummary(tool: string, data: unknown): string {
  if (tool === "snapshot" && data && typeof data === "object") {
    const snap = data as { pageContent?: string };
    const lines = snap.pageContent?.split("\n").length ?? 0;
    return i18n.t("errors.capturedElements", { count: lines });
  }
  if (tool === "click" && data && typeof data === "object") {
    const pos = data as { x: number; y: number };
    return i18n.t("errors.clickedAt", { x: pos.x, y: pos.y });
  }
  if (tool === "press_key") {
    return i18n.t("errors.keyPressed");
  }
  if (tool === "navigate") {
    return i18n.t("errors.navigated");
  }
  if (tool === "switch_tab" && data && typeof data === "object") {
    return i18n.t("errors.switchedTo", { title: (data as { title?: string }).title ?? "" });
  }
  if (tool === "list_tabs" && data && typeof data === "object") {
    const tabs = (data as { tabs?: unknown[] }).tabs;
    return i18n.t("errors.tabsListed", { count: Array.isArray(tabs) ? tabs.length : 0 });
  }
  if (tool === "screenshot") {
    return i18n.t("errors.screenshotCaptured");
  }
  if (tool === "remember" && data && typeof data === "object") {
    // The fact itself is the summary — "Saved to memory" tells the user nothing
    // about what Regent now knows, which is the only interesting part.
    return (data as { fact: string }).fact;
  }
  if (tool === "ask_user" && data && typeof data === "object") {
    // The question is the summary — the card renders it as the headline.
    return (data as { question?: string }).question ?? "";
  }
  return i18n.t("errors.toolCompleted", { tool });
}
