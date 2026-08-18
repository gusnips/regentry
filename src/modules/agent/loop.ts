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
import { listSchedules } from "@/modules/schedule";
import { loadSkillsForRun } from "@/modules/skills";
import type { ToolDef } from "@/modules/providers/types";
import { executeTool, formatDetail, formatSuccessSummary } from "./tools";
import type { RunGroup } from "./tools";
import type { RunOwner } from "./active-runs";
import { buildSystemPrompt, buildTaskMessage, buildToolDefs } from "./prompt";
import type { PreviousTab, RunMode } from "./prompt";
import { compactRunMessages } from "./compact";
import { DEFAULT_CONTEXT_WINDOW, needsCompaction } from "@/modules/providers/context-window";

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
 * how the agent reaches the page it must read before it can plan (the run
 * starts on the tab it's driving, so "look at the Gmail tab first" is the
 * normal opening move), and gating it produced a red ✗ on the very first step
 * of runs that were behaving correctly. Focus-stealing is the driver's call
 * (activateOnSwitch), not the gate's.
 *
 * evaluate IS here: page-context JS can do anything a click can and more, so
 * it waits for the same approval — the code itself rides in the step row's
 * args, which is the transparency the gate's yes rests on. read_network_requests
 * and read_console_messages stay free: they only watch what the tab already did.
 */
const ACTION_TOOLS = new Set([
  "navigate",
  "go_back",
  "open_tab",
  "close_tab",
  "click",
  "type",
  "fill",
  "evaluate",
  "press_key",
  "scroll_down",
  "scroll_up",
]);

/**
 * What the plan gate holds back. Every action tool, plus `schedule_task` —
 * which touches no page but commits the browser to future unattended work, so
 * it needs the same yes. It is deliberately NOT in ACTION_TOOLS: that set also
 * decides what mints the run's tab strip, and scheduling has no tab to file.
 *
 * `cancel_schedule` is ungated on purpose. Cancelling only ever removes future
 * work, and it is how a self-paced loop ends itself.
 */
const GATED_TOOLS = new Set([...ACTION_TOOLS, "schedule_task"]);

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
  /**
   * The provider refused a turn for length at `observedInput` tokens — so the
   * real context window is below it. The caller records it, and every later run
   * on this model compacts before reaching that number instead of after.
   */
  onContextLimit?: (observedInput: number) => void;
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
  /**
   * The conversation this run belongs to — read_history reads its stored
   * transcript. Absent only in tests.
   */
  conversationId?: string;
  /** The run's tab strip — minted at the first action, group_tab's target. */
  runGroup?: RunGroup;
  /** Which client started the run — `schedule_task` is bounded by it. Absent in tests. */
  owner?: RunOwner;
  /** The schedule this run fired from — the only record `schedule_task` may re-time. */
  scheduleId?: string;
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
   * URL of the tab the run starts on — scopes AGENTS.md/MEMORY.md to its site's
   * `## site:` sections. Absent (tests, unknown tab) = global content only.
   */
  startUrl?: string;
  /**
   * The stored conversation as alternating user/assistant turns, replayed
   * between the system prompt and the fresh task so a continuation lands on a
   * model that has read the same exchange. The adapters serialize it with the
   * same code path as this run's own turns.
   */
  history?: ChatMessage[];
  /**
   * The model's context window in tokens, as best anyone can know it — see
   * providers/context-window.ts for how it is learned. The run folds its older
   * turns into a progress note before reaching it, so a long task shrinks its
   * own context instead of dying on a provider rejection halfway through.
   */
  contextWindow?: number;
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
    conversationId,
    runGroup,
    owner,
    scheduleId,
    images,
    supportsImages: supportsImagesOpt,
    previousTabs,
    mode,
    startUrl,
    history,
    contextWindow = DEFAULT_CONTEXT_WINDOW,
    drainInjected,
    signal,
    callbacks: rawCallbacks,
  } = opts;
  // The last turn's input token count IS this run's context size — the provider
  // measures it for us every turn, so nothing here has to estimate. Intercepted
  // rather than asked for separately: onUsage already carries the number.
  let lastInput = 0;
  const callbacks: LoopCallbacks = {
    ...rawCallbacks,
    onUsage: (input, output) => {
      if (input > 0) lastInput = input;
      rawCallbacks.onUsage?.(input, output);
    },
  };
  const supportsImages = supportsImagesOpt ?? true;
  log.info("run started:", truncate(task, 120));

  // AGENTS.md / MEMORY.md are read once, here: a run keeps the context it started
  // with, so editing a doc mid-run never rewrites the instructions under the model.
  // The standing schedules ride along for the same reason and in the same shape
  // — a list the model is shown, so "what do I have scheduled?" costs no call.
  // Skills follow both rules at once: the catalog scopes to the start site the
  // way the docs do, and the tool resolves against this snapshot for the whole
  // run. The snapshot is independent of all of it — they run concurrently.
  const [context, schedules, runSkills, initial] = await Promise.all([
    loadAgentContext(startUrl),
    listSchedules(),
    loadSkillsForRun(startUrl),
    driver.snapshot(),
  ]);
  const tools = buildToolDefs(context.memoryOn, supportsImages, runSkills.all.length > 0);

  // Auto-snapshot merged into the task message — Anthropic rejects consecutive user messages
  const messages: ChatMessage[] = [
    {
      role: "system",
      content: buildSystemPrompt(
        context,
        currentLanguageName(),
        supportsImages,
        schedules,
        runSkills.applicable,
      ),
    },
    ...(history ?? []),
    {
      role: "user",
      content: buildTaskMessage(task, initial.pageContent, {
        previousTabs,
        mode,
        ...(scheduleId ? { scheduleId } : {}),
      }),
      // The user's own attachments are the subject of the task — unlike screenshots
      // they are never pruned, or a long run would forget what it was asked about.
      // A text-only model can't receive them; dropping the whole field keeps the wire valid.
      ...(images?.length && supportsImages ? { images } : {}),
    },
  ];

  // Where the task message sits, and what it said before any progress note was
  // attached to it — compaction rebuilds the note from this, so a second pass
  // replaces the first instead of summarizing a summary.
  const taskIndex = messages.length - 1;
  const originalTask = messages[taskIndex]?.content ?? task;

  /**
   * Fold the run's older turns into the task's progress note. Reports the fold
   * as a step so the user can see why the transcript's middle went quiet, and
   * swallows its own failure: a compaction that errors must not end a run that
   * was otherwise fine — the turn still has whatever headroom it had.
   */
  const compactNow = async (): Promise<boolean> => {
    try {
      const removed = await compactRunMessages(provider, messages, taskIndex, originalTask, signal);
      if (removed === 0) return false;
      callbacks.onStep?.({
        tool: "compact",
        summary: i18n.t("compact.folded", { count: removed }),
        ok: true,
      });
      return true;
    } catch (e) {
      if (signal.aborted) throw e;
      log.warn("compaction failed:", e instanceof Error ? e.message : String(e));
      return false;
    }
  };

  // The user's attachment silently vanished — make it a visible step, not a mystery.
  if (images?.length && !supportsImages) {
    callbacks.onStep?.({ tool: "warn", summary: i18n.t("errors.textOnlyImages") });
  }

  // The approved plan for this run — null until the user says yes to one.
  // Action tools are gated on it, so a model that skips planning gets an error
  // tool-result pointing it back at the plan tool instead of a free pass.
  let approvedPlan: PlanPayload | null = null;
  // Set when the user's own mid-run message lands between plan calls: the next
  // replan answers their words, and their words already approved what they
  // asked for — parking there would be requesting permission to obey.
  let steeredSincePlan = false;
  // One retry for a `done` the output cap emptied of both summary and streamed
  // text — bounded so a model that keeps truncating still closes, never loops.
  let retriedTruncatedDone = false;
  // One context-overflow recovery per run — a fold that still doesn't fit will
  // not fit on the next attempt either, and retrying would only burn calls.
  let recoveredFromOverflow = false;

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

    // Proactive: the last turn came back close enough to the ceiling that the
    // next one may not fit. Folding here — between turns — is the only place it
    // is free: no tool call is in flight and no result is waiting for its id.
    if (needsCompaction(lastInput, contextWindow)) {
      log.info(`context at ${lastInput}/${contextWindow} — compacting before the next turn`);
      if (await compactNow()) lastInput = 0;
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
      const kind = e instanceof ProviderError ? e.kind : undefined;

      // Reactive: the provider just told us the window is smaller than we
      // thought. That refusal is the only hard number anyone ever gives us —
      // record it so every later run on this model compacts before this point,
      // then fold and retry the same step. Retried once: if a run that just
      // shed its history is still too big, the next attempt sheds nothing new
      // and only costs the user another failed call.
      if (kind === "context" && !recoveredFromOverflow) {
        recoveredFromOverflow = true;
        // The estimate stands in when the refusal carried no usage — guessing
        // low only compacts earlier than needed, never later.
        callbacks.onContextLimit?.(lastInput > 0 ? lastInput : contextWindow);
        log.warn(`context window exceeded at ~${lastInput} tokens — compacting and retrying`);
        if (await compactNow()) {
          lastInput = 0;
          // The turn never happened, so it must not cost a step — but the
          // budget nudge this step may have pushed is still the last message,
          // and re-pushing it on the retry would put two user turns
          // back-to-back, which Anthropic rejects outright.
          if ((nearEnd || finalizing) && messages[messages.length - 1]?.role === "user") {
            messages.pop();
          }
          step--;
          continue;
        }
      }
      // A classified state (rate limit, quota, auth…) isn't a run fault — warn keeps
      // it off chrome://extensions' Errors page. Unclassified shapes stay errors:
      // they're the signal that a provider changed something we don't know yet.
      if (kind) {
        log.warn(`run failed at step ${step + 1}:`, msg);
      } else {
        log.error(`run failed at step ${step + 1}:`, msg);
      }
      // A classified provider error leads with its own complete line ("…hit your
      // weekly usage limit — resets…") — wrapping it in "Provider error:" would
      // frame a state as a failure. Unclassified errors keep the envelope.
      callbacks.onError?.(kind ? msg : i18n.t("errors.providerError", { message: msg }), kind);
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
      //
      // A truncated turn is the special case: the cap cut the tool call the
      // text was wrapping, and the text already IS the answer. Re-reasoning
      // would burn the budget a second time for nothing — so name the cut and
      // point it at closing over what's already written, not a fresh pass. The
      // ask is "restate it", never "summarize it short": after a length error
      // the model's own caution already leans small, and a hard task's answer
      // wants its full size.
      messages.push({
        role: "user",
        content: turn.truncated
          ? "You hit the output limit and the tool call at the end was cut off — but your text above is already the full answer. Don't reason or call any other tool: call `done` now, and put that same answer in the summary, restated in full — if it's long, break it into smaller pieces so it isn't cut again."
          : "Respond with a tool call, not plain text. If you just asked the user a question, call `ask_user` with that same question now — written-out questions do not pause the run, so the user never got to answer. Otherwise make progress on the task: call snapshot if you need to see the page, or `done` if the task is complete.",
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
      // A whole-arc nudge for the plan call's result — set when a replan
      // shrinks below work the run already finished.
      let note: string | undefined;

      // The gate: no page action runs before the user has approved a plan.
      // The tool-result error tells the model exactly how to unblock itself.
      if (GATED_TOOLS.has(call.name) && !approvedPlan) {
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
      const result = await executeTool(call, driver, {
        conversationId,
        runGroup,
        owner,
        scheduleId,
        skills: runSkills.all,
      });
      // The strip appears when the work does: landing a gated action files the
      // driven tab into the run's group. Reads never group — a tab the user was
      // merely passing through stays exactly as they filed it.
      if (result.ok && ACTION_TOOLS.has(call.name)) await runGroup?.touch();
      if (!result.ok) log.warn(`tool ${call.name} failed:`, result.error);

      if (bookkeeping && result.ok) {
        const plan = result.data as PlanPayload;
        // Shown before the answer arrives — the user approves what they see.
        callbacks.onPlan?.(plan);
        // A replan written in answer to the user's own mid-run message never
        // asks — their message already approved what it asked for. The flag is
        // consumed either way, so a later self-initiated deviation still asks.
        const steered = steeredSincePlan;
        steeredSincePlan = false;
        // The first proposal always asks. A later one asks again only when the
        // model flags its own update as a deviation (`deviates_from_approved`):
        // string-diffing re-asked on every reworded step, so what is worth a
        // fresh approval is the plan writer's call, not the gate's. An absent
        // flag means silent — under-asking is the chosen failure direction.
        const needsApproval =
          !approvedPlan || (call.args.deviates_from_approved === true && !steered);
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
        if (!revision) {
          // The cursor moving backwards is the one smell a narrowed list can't
          // hide: the new arc claims less done than the run already finished,
          // so the card just lost its history. The update still lands (the
          // model is the list's one writer — merging lists would put words in
          // its mouth); the note asks it to re-send the whole arc.
          if (approvedPlan && plan.current < approvedPlan.current) {
            note = i18n.t("plan.narrowedNote");
          }
          approvedPlan = plan;
        }
      } else {
        callbacks.onStep?.({
          tool: call.name,
          summary: result.ok
            ? formatSuccessSummary(call.name, result.data)
            : i18n.t("errors.failed", { error: result.error }),
          ok: result.ok,
          args: call.args,
          detail: formatDetail(call.name, result, call.args),
          images: result.images,
        });
      }

      if (call.name === "done") {
        // The summary is a re-generation slot — the first thing the output cap
        // cuts, and on a truncated call parseToolArgs already reduced it to {}.
        // The answer the model actually produced is the text it streamed this
        // turn: that IS the report, so fall back to it before ever landing on
        // the hollow "task complete" line.
        const fromArgs = (result.data as { summary?: string })?.summary?.trim();
        const fallback = turn.text.trim();
        const summary = fromArgs || fallback;
        if (summary) {
          taskDone = true;
          log.info(`run done after step ${step + 1}:`, truncate(summary, 120));
          callbacks.onDone?.(summary);
        } else if (turn.truncated && !retriedTruncatedDone) {
          // Cut so deep even the text is empty: closing on "task complete"
          // would throw away a run's whole answer. One cheap retry — the
          // recovery note tells the model the report already exists in its
          // history, so it restates it instead of reasoning a second pass.
          retriedTruncatedDone = true;
          log.warn("done arrived empty on a truncated turn — asking for the answer plainly");
          results.push({
            id: call.id,
            content: JSON.stringify({
              error: i18n.t("errors.doneLostSummary"),
            }),
          });
        } else {
          // Not truncated, or the retry already failed — close on the line.
          taskDone = true;
          callbacks.onDone?.(i18n.t("errors.taskComplete"));
        }
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
                : note
                  ? { ...(result.data as PlanPayload), note }
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

    // A finished run leaves its queue unconsumed — the panel recalls it on a
    // natural end, or sends it as the next task on a user stop. Draining here
    // would bubble messages the model never saw (done already fired above).
    if (taskDone) return messages;

    // Queued mid-run messages join here, after the tool results they comment on.
    for (const item of drainInjected?.() ?? []) {
      log.info("injected mid-run message:", truncate(item.text, 120));
      messages.push({ role: "user", content: item.text });
      callbacks.onInjected?.(item.id, item.text);
      // The user just redirected the run — the replan it triggers carries
      // their yes with it (see the plan gate above).
      steeredSincePlan = true;
    }
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
