import type { BrowserDriver } from "@/modules/browser";
import type {
  ChatProvider,
  ChatMessage,
  ToolCall,
  Delta,
  ToolResult as ProviderToolResult,
} from "@/modules/providers/types";
import { isRetryable, ProviderError } from "@/modules/providers/types";
import type { ErrorKind } from "@/modules/providers/error-classify";
import type { StepPayload, PlanPayload } from "@/shared/protocol";
import { createLogger, truncate } from "@/lib/logger";
import { i18n, currentLanguageName } from "@/i18n";
import { loadAgentContext } from "@/modules/memory";
import type { ToolDef } from "@/modules/providers/types";
import { executeTool, formatDetail, formatSuccessSummary } from "./tools";
import { buildSystemPrompt, buildTaskMessage, buildToolDefs } from "./prompt";
import type { PreviousTab, RunMode } from "./prompt";

const log = createLogger("agent");

/**
 * One turn per step. The budget is a runaway backstop and a checkpoint cadence,
 * not a task-size limit: the near-end nudge (below) offers the model a clean
 * "ask the user whether to continue" exit whose answer starts a fresh run with
 * history replayed. 150 turns was ~10 minutes of real work — a normal
 * multi-part task (two lists, two file imports) hit it mid-job. 500 covers
 * anything a user would reasonably sit through while still bounding a stuck
 * loop's spend.
 */
export const MAX_STEPS = 500;
/** Transient stream failures are retried in place this many times before surfacing. */
const MAX_STREAM_ATTEMPTS = 3;
const BASE_BACKOFF_MS = 1000;
const MAX_BACKOFF_MS = 15_000;
/** Result payload kept for the panel's expandable step row — a page snapshot is far larger. */
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

/**
 * Tools that change the browser or the account behind it. Everything else the
 * agent can do is a read (snapshot, screenshot, list_tabs), bookkeeping (plan,
 * remember), or a run-control call (ask_user, done) — those stay free so the
 * model can look at the page before proposing its plan.
 *
 * switch_tab is deliberately NOT here: it changes nothing on any page, it is
 * how the agent reaches the page it must read before it can plan (a background
 * run starts on a tab of its own, so "look at the Gmail tab first" is the
 * normal opening move), and gating it produced a red ✗ on the very first step
 * of runs that were behaving correctly. Focus-stealing is the driver's call
 * (activateOnSwitch), not the gate's.
 */
const ACTION_TOOLS = new Set([
  "navigate",
  "click",
  "type",
  "press_key",
  "scroll_down",
  "scroll_up",
]);

/**
 * A turn's tool calls with `plan` first. Models routinely batch the plan with
 * the first action of that plan in one turn; executed in wire order the action
 * hits the gate and is rejected, even though its approval was one call away.
 * Hoisting costs nothing (results are matched to calls by id on every adapter)
 * and turns a guaranteed bounce into the intended flow.
 */
function planFirst(calls: ToolCall[]): ToolCall[] {
  return [...calls].sort((a, b) => Number(b.name === "plan") - Number(a.name === "plan"));
}

/**
 * Does an updated plan deviate from what the user approved? Only the UPCOMING
 * steps matter — advancing `current` is progress, and rewriting finished steps
 * changes nothing the user is still exposed to. Any upcoming step that was not
 * in the approved remainder re-opens approval. The comparison is plain string
 * equality on purpose: a reworded step re-asks too, because for a gate whose
 * whole job is "nothing runs that you didn't see", over-asking beats
 * under-asking.
 */
export function planNeedsReapproval(approved: PlanPayload, next: PlanPayload): boolean {
  const remaining = new Set(approved.steps.slice(approved.current));
  return next.steps.slice(next.current).some((step) => !remaining.has(step));
}

/** The user's answer to a parked plan. */
export interface PlanApprovalOutcome {
  /** false ends the run — unless `feedback` rides along. */
  approved: boolean;
  /**
   * A "no" with changes attached is a revision request, not a rejection: the
   * run stays alive, the note goes back to the model in the plan tool's own
   * result, and the REVISED plan is parked for approval again.
   */
  feedback?: string;
}

export interface LoopCallbacks {
  onToken?: (text: string) => void;
  onReasoning?: (text: string) => void;
  onStepStart?: (tool: string, args: Record<string, unknown>) => void;
  /** Wire shape lives in shared/protocol — producer and panel share one definition. */
  onStep?: (step: StepPayload) => void;
  onPlan?: (plan: PlanPayload) => void;
  /**
   * A proposed plan parked on user approval — resolves the user's answer.
   * Absent = auto-approve (tests, non-interactive callers); the panel wires
   * the real gate.
   */
  onPlanApproval?: (steps: string[], reapproval: boolean) => Promise<PlanApprovalOutcome>;
  /** A queued mid-run message was consumed — the panel turns its pending line into a real one. */
  onInjected?: (id: string, text: string) => void;
  onUsage?: (input: number, output: number) => void;
  /** `kind` is the provider's classified failure — the UI renders its own lead line then. */
  onError?: (message: string, kind?: ErrorKind) => void;
  onDone?: (summary?: string) => void;
  /**
   * The run ended on a question for the user — not on error and not on done.
   * `choices` carries the tappable options when the answer is one of a few
   * concrete ones (absent = an open answer), so every surface relaying the
   * question can offer what the model actually expects back.
   */
  onAskUser?: (question: string, choices?: string[]) => void;
}

export interface LoopOptions {
  provider: ChatProvider;
  driver: BrowserDriver;
  task: string;
  /** Data-URL images the user attached to the task, referenced in the text as "[Image #1]". */
  images?: string[];
  /**
   * Whether the provider's model can receive images. Text-only models (DeepSeek)
   * get no screenshot tool and never see user-attached images — putting an
   * image_url on their wire is a hard 400. Absent = capable.
   */
  supportsImages?: boolean;
  /**
   * The tabs the conversation's earlier runs drove — set only for ones this run
   * is not on, so a continuation typed elsewhere can still find its way back.
   */
  previousTabs?: PreviousTab[];
  /** Where this run works and what it was kept from — see RunMode. */
  mode?: RunMode;
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
      // A server's retry-after (only short ones reach here — isRetryable gives
      // up on long waits) outranks the backoff guess.
      const retryAfterMs = e instanceof ProviderError ? (e.retryAfterMs ?? 0) : 0;
      await sleep(Math.max(backoffMs(attempt), retryAfterMs));
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
    supportsImages: supportsImagesOpt,
    previousTabs,
    mode,
    history,
    drainInjected,
    signal,
    callbacks,
  } = opts;
  const supportsImages = supportsImagesOpt ?? true;
  log.info("run started:", truncate(task, 120));

  // AGENTS.md / MEMORY.md are read once, here: a run keeps the context it started
  // with, so editing a doc mid-run never rewrites the instructions under the model.
  // The snapshot is independent of the docs — both run concurrently.
  const [context, initial] = await Promise.all([loadAgentContext(), driver.snapshot()]);
  const tools = buildToolDefs(context.memoryOn, supportsImages);

  // Auto-snapshot merged into the task message — Anthropic rejects consecutive user messages
  const messages: ChatMessage[] = [
    { role: "system", content: buildSystemPrompt(context, currentLanguageName(), supportsImages) },
    ...(history ?? []),
    {
      role: "user",
      content: buildTaskMessage(task, initial.pageContent, { previousTabs, mode }),
      // The user's own attachments are the subject of the task — unlike screenshots
      // they are never pruned, or a long run would forget what it was asked about.
      // A text-only model can't receive them; dropping the whole field keeps the wire valid.
      ...(images?.length && supportsImages ? { images } : {}),
    },
  ];

  // The user's attachment silently vanished — make it a visible step, not a mystery.
  if (images?.length && !supportsImages) {
    callbacks.onStep?.({ tool: "warn", summary: i18n.t("errors.textOnlyImages") });
  }

  // The approved plan for this run — null until the user says yes to one.
  // Action tools are gated on it, so a model that skips planning gets an error
  // tool-result pointing it back at the plan tool instead of a free pass.
  let approvedPlan: PlanPayload | null = null;

  for (let step = 0; step < MAX_STEPS; step++) {
    if (signal.aborted) {
      callbacks.onDone?.();
      return messages;
    }

    // Step-budget finalize: one step before the hard limit, offer the model the
    // choice between wrapping up (done) and asking the user whether to continue
    // (ask_user) — the answer then starts a fresh run with history replayed, so a
    // long task resumes with a clean budget and a clean context window. On the
    // final step, force a best-effort answer so the run never hangs with
    // "did not complete" (featury engine pattern) — ask_user stays available there.
    const nearEnd = step === MAX_STEPS - 2;
    const finalizing = step === MAX_STEPS - 1;
    if (nearEnd) {
      messages.push({
        role: "user",
        content:
          "You are near the end of your working budget. If you can wrap up meaningfully now, call `done` with your best summary of what you accomplished. If you genuinely need more work and have a concrete plan to finish, call `ask_user` to ask the user whether to continue — describe what you have done so far and offer specific choices (for example, keep digging vs stop). Only ask if continuing is meaningfully better than stopping here.",
      });
    } else if (finalizing) {
      messages.push({
        role: "user",
        content:
          "This is your final step. Call `done` now with your best summary of what you accomplished, based only on what you have already gathered. If you still need more work, you may call `ask_user` instead. Do not call any other tool.",
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
      const kind = e instanceof ProviderError ? e.kind : undefined;
      callbacks.onError?.(i18n.t("errors.providerError", { message: msg }), kind);
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
      // Model responded with text only — nudge it back to tools. The ask_user
      // steer matters most: a question typed as prose does not pause the run,
      // so without it the agent plows ahead on its own assumptions while the
      // user stares at a question they cannot answer.
      messages.push({
        role: "user",
        content:
          "Respond with a tool call, not plain text. If you just asked the user a question, call `ask_user` with that same question now — written-out questions do not pause the run, so the user never got to answer. Otherwise make progress on the task: call snapshot if you need to see the page, or `done` if the task is complete.",
      });
      continue;
    }

    // Execute each tool call
    let taskDone = false;
    const results: ProviderToolResult[] = [];

    for (const call of planFirst(turn.toolCalls)) {
      if (signal.aborted) {
        callbacks.onDone?.();
        return messages;
      }
      // The user's revision note for THIS plan call — rides back in its tool
      // result (a separate user message would butt against the tool_results
      // one, and Anthropic rejects consecutive same-role turns).
      let revision: string | undefined;

      // The gate: no page action runs before the user has approved a plan.
      // The tool-result error tells the model exactly how to unblock itself.
      if (ACTION_TOOLS.has(call.name) && !approvedPlan) {
        log.warn(`tool ${call.name} blocked — no approved plan yet`, call.args);
        callbacks.onStep?.({
          tool: call.name,
          summary: i18n.t("errors.planGate"),
          ok: false,
          args: call.args,
          // A red ✗ with no way to ask "why?" is the one thing every other step
          // row avoids — the drawer carries the same explanation the model got.
          detail: i18n.t("errors.planGateModel"),
        });
        results.push({
          id: call.id,
          content: JSON.stringify({ error: i18n.t("errors.planGateModel") }),
        });
        continue;
      }

      // The plan is bookkeeping, not an action on the page: it replaces a card
      // rather than adding a row, so it gets no spinner and no step of its own.
      const bookkeeping = call.name === "plan";
      if (!bookkeeping) callbacks.onStepStart?.(call.name, call.args);
      const result = await executeTool(call, driver);
      if (!result.ok) log.warn(`tool ${call.name} failed:`, result.error);

      if (bookkeeping && result.ok) {
        const plan = result.data as PlanPayload;
        // Shown before the answer arrives — the user approves what they see.
        callbacks.onPlan?.(plan);
        // The first proposal always asks; a later one asks again only when it
        // deviates from the approved plan — progress alone never re-prompts.
        const needsApproval = !approvedPlan || planNeedsReapproval(approvedPlan, plan);
        if (needsApproval) {
          const outcome = (await callbacks.onPlanApproval?.(plan.steps, approvedPlan !== null)) ?? {
            approved: true,
          };
          if (signal.aborted) {
            callbacks.onDone?.();
            return messages;
          }
          if (!outcome.approved) {
            revision = outcome.feedback?.trim() || undefined;
            if (!revision) {
              log.info("plan rejected by user");
              callbacks.onDone?.(i18n.t("errors.planRejected"));
              return messages;
            }
            // Revision, not rejection: the gate re-arms (the REVISED plan asks
            // again) and the run continues on the note below.
            log.info("plan returned for revision:", truncate(revision, 120));
            approvedPlan = null;
          }
        }
        if (!revision) approvedPlan = plan;
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
        // Coerced here, once, so no consumer has to re-validate model output.
        callbacks.onAskUser?.((call.args.question as string) ?? "", askChoices(call.args.choices));
        callbacks.onDone?.();
      } else {
        results.push({
          id: call.id,
          // JSON.stringify(undefined) is undefined, and a tool message whose
          // `content` key drops out of the body is a 400 on strict deserializers
          // (DeepSeek: "missing field content"). No-data tools (type, keys,
          // scroll) still report success as {ok:true}.
          content: JSON.stringify(
            !result.ok
              ? { error: result.error }
              : revision
                ? { revision, note: i18n.t("plan.revisionNote") }
                : (result.data ?? { ok: true }),
          ),
          // The screenshot tool is withheld from text-only models, so images can't
          // normally get here — the guard keeps any future image tool off the wire.
          ...(result.images?.length && supportsImages ? { images: result.images } : {}),
        });
      }
    }

    // Feed results back as ONE message — Anthropic requires all tool_results
    // for a turn in a single user message; OpenAI adapter expands to N messages.
    if (results.length > 0) {
      messages.push({ role: "tool_results", content: "", toolResults: results });
      pruneImages(messages);
      pruneResultText(messages);
    }

    // Queued mid-run messages join here, after the tool results they comment on.
    // A run that ends on `done` leaves its queue unconsumed — the panel recalls
    // it on a natural end, or sends it as the next task on a user stop.
    for (const item of drainInjected?.() ?? []) {
      log.info("injected mid-run message:", truncate(item.text, 120));
      messages.push({ role: "user", content: item.text });
      callbacks.onInjected?.(item.id, item.text);
    }

    if (taskDone) return messages;
  }

  // Unreachable in practice — the near-end nudges fire before the final step — but
  // if the model ignored them, close out gracefully instead of hanging.
  callbacks.onDone?.(i18n.t("errors.stepBudgetExhausted"));
  return messages;
}

/**
 * The model's `choices` argument, made safe to hand on: strings only, blanks
 * and duplicates dropped, absent when nothing survives. Mirrors what the panel's
 * QuestionCard does with the stored args — a relay should never have to guess
 * whether an option is real.
 */
function askChoices(raw: unknown): string[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const choices = [
    ...new Set(raw.filter((c): c is string => typeof c === "string" && c.trim() !== "")),
  ];
  return choices.length > 0 ? choices : undefined;
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
 * Bound the text side of the same problem images have: every tool result is
 * re-sent on every later turn, and a page snapshot is the largest thing a run
 * produces. Left alone, a long run grows its own request body until the
 * provider rejects it — the failure lands as a raw context-length 400 mid-task,
 * which is exactly the dead end the step budget's checkpoint exists to avoid.
 *
 * Only the newest results keep their payload. Older ones keep their id — the
 * wire requires one result per call — and a line saying the content was
 * dropped, so the model re-fetches instead of trusting a blank. A stale
 * snapshot is the cheapest thing in the run to lose: it describes a page that
 * has since been clicked, typed into, and navigated away from.
 *
 * ponytail: characters, not tokens, and no per-model ceiling — the same
 * simplification buildConversationHistory makes, and the budgets are siblings
 * (~30k tokens of results beside history's ~6k). The ceiling is a model that
 * gathered data across many pages losing the oldest of it; the upgrade path is
 * trimming against the resolved model's real context window.
 */
const MAX_RESULT_CHARS = 120_000;

function pruneResultText(messages: ChatMessage[]): void {
  let budget = MAX_RESULT_CHARS;
  for (let i = messages.length - 1; i >= 0; i--) {
    for (const result of messages[i]?.toolResults ?? []) {
      if (budget > 0) budget -= result.content.length;
      else if (result.content !== TRIMMED_RESULT) result.content = TRIMMED_RESULT;
    }
  }
}

const TRIMMED_RESULT = JSON.stringify({
  trimmed: "Older result dropped to save context. Re-run the tool if you still need it.",
});

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
