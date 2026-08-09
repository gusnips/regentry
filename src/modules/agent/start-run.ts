import { i18n } from "@/i18n";
import { buildConversationHistory, runAgentLoop } from ".";
import { extractAndRemember } from "@/modules/memory";
import {
  clearAgentWait,
  createDriver,
  hideAgentIndicator,
  isRestrictedUrl,
  showAgentIndicator,
  waitAgentIndicator,
  waitForLoad,
} from "@/modules/browser";
import {
  createProvider,
  ensureProviderCredential,
  getActiveProvider,
  resolveProviderModel,
} from "@/modules/providers";
import type { ResolvedProviderConfig } from "@/modules/providers/types";
import { getConversationTabsFor, getMessages, recordDrivenTabFor } from "@/modules/conversation";
import type { Message } from "@/modules/conversation/types";
import { defaultStartUrl } from "@/lib/prefs";
import { createLogger, truncate } from "@/lib/logger";
import type { Event } from "@/shared/protocol";
import { acquireRun, releaseRun } from "./active-runs";
import type { ActiveRun, RunOwner } from "./active-runs";
import type { PlanApprovalOutcome } from "./loop";
import { markRunningAwaiting, markRunningTab } from "./run-queue";

const log = createLogger("bg");

export interface StartRunOptions {
  /** The conversation this run's transcript lives in — the panel's active one,
   *  or the bridge's dedicated MCP thread. */
  conversationId: string;
  owner: RunOwner;
  task: string;
  images?: string[];
  /** Where a background run's tab starts — wins over the default start URL. */
  url?: string;
  /** Drive the user's current tab instead of opening a background one — an
   *  explicit opt-in, never the default. */
  thisPage?: boolean;
  /** Streams run events to the client — the panel port or the bridge's WS. */
  emit: (event: Event) => void;
  /** The run ended on an ask_user question; the client may want to react
   *  (the panel fires an OS notification, the bridge records a pending answer). */
  onAskUser?: (question: string, choices?: string[]) => void;
  /** The run parked on a plan approval — the away notification's cue, same as ask_user. */
  onPlanApprovalRequest?: (steps: string[], reapproval: boolean) => void;
}

export type StartRunResult = { ok: true } | { ok: false; active: ActiveRun };

/**
 * The full run-start flow, shared by the panel port and the MCP bridge: claim
 * the single run slot, resolve provider + target tab, drive the loop, distill
 * memory, persist the driven tab. A conflict is returned (never swallowed) so
 * each caller can word it for its own audience.
 */
export async function startAgentRun(opts: StartRunOptions): Promise<StartRunResult> {
  const { conversationId, owner, task, images, emit, onAskUser, onPlanApprovalRequest } = opts;
  const claim = acquireRun(conversationId, owner);
  if (!claim.ok) return { ok: false, active: claim.active };
  const { run } = claim;

  try {
    const [providerConfig, transcript] = await Promise.all([
      getActiveProvider(),
      getMessages(conversationId),
    ]);
    if (!providerConfig) {
      emit({ type: "error", message: i18n.t("errors.noActiveProvider") });
      return { ok: true };
    }

    // Resolve "auto" model to a concrete id at run start — mid-task changes to
    // the stored config never affect a run in flight. An OAuth provider gets a
    // fresh access token first, so a long-idle session doesn't 401 mid-task.
    // Checked before the tab is created so a provider failure never orphans one.
    let provider;
    let resolvedProvider: ResolvedProviderConfig | undefined;
    try {
      resolvedProvider = await resolveProviderModel(await ensureProviderCredential(providerConfig));
      provider = createProvider(resolvedProvider);
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      log.error("provider setup failed:", message);
      emit({ type: "error", message });
      return { ok: true };
    }

    // Where the run drives: the user's current tab only when explicitly asked,
    // a fresh background tab otherwise — dispatch-and-forget never hijacks
    // what the user is reading. An answer continues where the question arose:
    // a transcript parked on an unanswered ask_user starts from the page the
    // conversation last drove, not the default start URL.
    const conversationTabs = await getConversationTabsFor(conversationId);
    const continuationUrl = hasPendingQuestion(transcript)
      ? conversationTabs[0]?.url
      : undefined;
    const target = await resolveRunTab(opts, continuationUrl);
    if ("error" in target) {
      emit({ type: "error", message: target.error });
      return { ok: true };
    }
    const { tab, groupId } = target;
    if (!tab.id) {
      emit({ type: "error", message: i18n.t("errors.noActiveTab") });
      return { ok: true };
    }
    markRunningTab(conversationId, tab.id);

    // The conversation may have worked on other pages than this run's start
    // (one run per message, and users move between messages). Name those tabs
    // so references like "that email" or "the doc" can find their way back
    // (rule 6 does the rest).
    const previousTabs = tab.url
      ? conversationTabs.filter((t) => t.url !== tab.url)
      : [];

    log.info("run queued", {
      provider: providerConfig.name,
      model: providerConfig.model ?? "auto",
      tabId: tab.id,
      task: truncate(task, 120),
    });

    let endedOnQuestion = false;
    // How the run's tab group is retitled when it lets go — ✓, ? or ✗.
    let runFailed = false;
    // A moving target: the run starts on the submit-time tab but the agent may
    // re-target itself with switch_tab — badge, panel chip and fail-fast all follow.
    let drivenTabId = tab.id;
    let drivenTitle = tabLabel(tab);
    const driver = createDriver(tab.id, (info) => {
      void hideAgentIndicator(drivenTabId);
      drivenTabId = info.id;
      drivenTitle = info.title;
      markRunningTab(conversationId, info.id);
      emit({
        type: "driving",
        tabId: info.id,
        windowId: info.windowId,
        title: info.title,
        favIconUrl: info.favIconUrl,
      });
      void showAgentIndicator(info.id, i18n.t("indicator.driving"));
    });
    emit({
      type: "driving",
      tabId: drivenTabId,
      windowId: tab.windowId,
      title: drivenTitle,
      favIconUrl: tab.favIconUrl || undefined,
    });

    // The driven tab going away is fatal, not transient: every later tool call
    // would fail the same way. End the run with a clear error instead of letting
    // the model burn turns retrying a dead tab id.
    const onTabGone = (removedId: number) => {
      if (removedId !== drivenTabId) return;
      log.info("driven tab closed mid-run", { tabId: drivenTabId });
      runFailed = true;
      // The user closed the tab — that IS the answer, no notification on top.
      emit({ type: "error", message: i18n.t("errors.tabClosed", { title: drivenTitle }), silent: true });
      run.controller.abort();
    };
    chrome.tabs.onRemoved.addListener(onTabGone);
    // Tell the page itself it is being driven — the side panel may be scrolled
    // away or on another window.
    await clearAgentWait();
    chrome.notifications.clear("tabrunner-question");
    chrome.notifications.clear("tabrunner-plan");
    void showAgentIndicator(drivenTabId, i18n.t("indicator.driving"));

    // The stored conversation as wire turns — "continue" lands on a model that
    // has read the same exchange, not on a stranger.
    const history = buildConversationHistory(transcript);

    try {
      const wire = await runAgentLoop({
        provider,
        driver,
        task,
        images,
        supportsImages: resolvedProvider?.supportsImages,
        history: history.length > 0 ? history : undefined,
        previousTabs: previousTabs.length > 0 ? previousTabs : undefined,
        drainInjected: () => run.injectedQueue.splice(0, run.injectedQueue.length),
        signal: run.controller.signal,
        callbacks: {
          onInjected: (id, text) => emit({ type: "injected", id, text }),
          onToken: (text) => emit({ type: "token", text }),
          onReasoning: (text) => emit({ type: "reasoning", text }),
          onStepStart: (tool, args) => emit({ type: "step_start", tool, args }),
          onStep: (step) => emit({ type: "step", ...step }),
          onPlan: (plan) => emit({ type: "plan", ...plan }),
          onPlanApproval: (steps, reapproval) => {
            // The bridge client is itself an AI carrying the consequential-action
            // policy — there is no human at its end of the wire to click approve,
            // and parking here would hang the run. The gate is the panel's; the
            // plan still crosses the bridge's event stream for its own review.
            if (owner === "bridge") return Promise.resolve({ approved: true });
            emit({ type: "plan_approval", steps, reapproval });
            // Parked runs stall silently otherwise — the user has usually tabbed
            // away by the time a mid-run replan asks again.
            onPlanApprovalRequest?.(steps, reapproval);
            // Parked means blocked-on-you, not working: the driven tab settles
            // into the same still "?" an ask_user wait shows, and the board's
            // pulse stops. An approve re-raises both; a reject (or stop) ends
            // the run, whose unwind clears them.
            markRunningAwaiting(conversationId, true);
            void waitAgentIndicator(drivenTabId);
            return new Promise<PlanApprovalOutcome>((resolve) => {
              run.planApproval = {
                resolve: (approved, feedback) => {
                  const revision = approved ? undefined : feedback?.trim() || undefined;
                  // Approve or revise: the run works again, so the working marks
                  // return. A plain reject ends it — its unwind clears them.
                  if (approved || revision) {
                    markRunningAwaiting(conversationId, false);
                    void showAgentIndicator(drivenTabId, i18n.t("indicator.driving"));
                  }
                  resolve(revision ? { approved: false, feedback: revision } : { approved });
                },
              };
              // A stop (or the panel closing) while parked answers "no", so the
              // loop unwinds instead of hanging on a promise nobody resolves.
              run.controller.signal.addEventListener(
                "abort",
                () => {
                  run.planApproval?.resolve(false);
                  run.planApproval = undefined;
                },
                { once: true },
              );
            });
          },
          onUsage: (input, output) => emit({ type: "usage", input, output }),
          onError: (message) => {
            runFailed = true;
            emit({ type: "error", message });
          },
          onDone: (summary) =>
            emit({ type: "done", summary, ...(endedOnQuestion ? { question: true } : {}) }),
          onAskUser: (question, choices) => {
            endedOnQuestion = true;
            onAskUser?.(question, choices);
          },
        },
      });
      // Memory is a background nicety: after a finished run, one cheap extra call
      // distills the durable facts the agent never got around to remembering.
      // Fire-and-forget — best-effort, a failed extraction never fails the run.
      if (!run.controller.signal.aborted && resolvedProvider) {
        void extractAndRemember(resolvedProvider, wire, run.controller.signal);
      }
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      log.error("run crashed:", message);
      runFailed = true;
      emit({ type: "error", message });
    } finally {
      chrome.tabs.onRemoved.removeListener(onTabGone);
      if (endedOnQuestion) void waitAgentIndicator(drivenTabId);
      else void hideAgentIndicator(drivenTabId);
      // Runs whatever unwinds the loop — done, error, stop, question.
      await persistDrivenTabFor(conversationId, drivenTabId);
      await settleRunTab(groupId, task, runFailed ? "failed" : endedOnQuestion ? "question" : "done");
    }
  } finally {
    releaseRun(run);
  }
  return { ok: true };
}

/** Best human label for a tab — its title, then hostname, then nothing. */
function tabLabel(tab: chrome.tabs.Tab): string {
  if (tab.title) return tab.title;
  try {
    return tab.url ? new URL(tab.url).hostname : "";
  } catch {
    return "";
  }
}

/**
 * The ask-gate's rule, background-side (the panel's copy lives in
 * conversation/ui/ask-gate.ts, which the runtime boundary keeps out of reach):
 * the newest ask_user with no user message after it is still awaiting an
 * answer — so this submission is a continuation, not a fresh task.
 */
function hasPendingQuestion(transcript: Message[]): boolean {
  for (let i = transcript.length - 1; i >= 0; i--) {
    const m = transcript[i];
    if (m?.role === "user") return false;
    if (m?.role === "step" && m.tool === "ask_user") return true;
  }
  return false;
}

type RunTab = { tab: chrome.tabs.Tab; groupId?: number };

/** Last-resort start page when neither the task nor the preference names one. */
const FALLBACK_START_URL = "https://www.google.com";

/**
 * Where the run drives. "this page" keeps the legacy semantics — the window's
 * active tab, refused early when injection could never reach it, given a moment
 * to finish loading. The default opens a fresh background tab (a run never
 * hijacks what the user is reading), waits for it to load, and labels its tab
 * group with the task so the strip says what that tab is. `continuationUrl`
 * wins over the default start URL — an answer continues where the question
 * arose.
 */
async function resolveRunTab(
  opts: StartRunOptions,
  continuationUrl?: string,
): Promise<RunTab | { error: string }> {
  if (opts.thisPage) {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) return { error: i18n.t("errors.noActiveTab") };
    if (isRestrictedUrl(tab.url)) return { error: i18n.t("errors.restrictedPage") };
    try {
      if (tab.status === "loading") await waitForLoad(tab.id, 10_000);
    } catch (e) {
      return { error: e instanceof Error ? e.message : String(e) };
    }
    return { tab };
  }

  const url = opts.url || continuationUrl || (await defaultStartUrl.get()) || FALLBACK_START_URL;
  if (isRestrictedUrl(url)) return { error: i18n.t("errors.restrictedPage") };
  let tab: chrome.tabs.Tab;
  try {
    tab = await chrome.tabs.create({ active: false, url });
  } catch (e) {
    return {
      error: i18n.t("errors.tabCreateFailed", {
        message: e instanceof Error ? e.message : String(e),
      }),
    };
  }
  if (!tab.id) return { error: i18n.t("errors.noActiveTab") };
  try {
    await waitForLoad(tab.id, 15_000);
  } catch (e) {
    // A tab the run never drove is litter — close it on the way out.
    void chrome.tabs.remove(tab.id).catch(() => {});
    return { error: e instanceof Error ? e.message : String(e) };
  }
  // Re-read after the wait — the created record predates the navigation.
  const loaded = await chrome.tabs.get(tab.id);
  const groupId = await labelRunTab(tab.id, opts.task);
  return { tab: loaded, groupId };
}

/** Tab-group titles cap at ~25 chars before they ellipsis into noise. */
const GROUP_TITLE_MAX = 25;

function groupTitle(task: string, mark = ""): string {
  const excerpt = task.replace(/\s+/g, " ").trim();
  const short =
    excerpt.length > GROUP_TITLE_MAX ? `${excerpt.slice(0, GROUP_TITLE_MAX)}…` : excerpt;
  return `${mark}${short}`;
}

/**
 * Group the run's tab and name the group after the task — the strip then says
 * what that background tab is. Best-effort: grouping must never fail a run.
 */
async function labelRunTab(tabId: number, task: string): Promise<number | undefined> {
  try {
    const groupId = await chrome.tabs.group({ tabIds: tabId });
    await chrome.tabGroups.update(groupId, { title: groupTitle(task), color: "purple" });
    return groupId;
  } catch (e) {
    log.debug("tab grouping skipped:", e instanceof Error ? e.message : String(e));
    return undefined;
  }
}

/**
 * Retitle the run's tab group with the outcome and collapse it — the strip
 * keeps saying what happened, out of the user's way. Best-effort: the tab may
 * already be gone.
 */
async function settleRunTab(
  groupId: number | undefined,
  task: string,
  outcome: "done" | "failed" | "question",
): Promise<void> {
  if (groupId === undefined) return;
  const mark = outcome === "failed" ? "✗ " : outcome === "question" ? "? " : "✓ ";
  try {
    await chrome.tabGroups.update(groupId, { title: groupTitle(task, mark), collapsed: true });
  } catch {
    // The tab (and its group) died during the run.
  }
}

/**
 * Remember the tab this run drove so the next run can spot a tab change.
 * The final state is read fresh — navigations mid-run leave the start-time
 * title and url stale.
 */
async function persistDrivenTabFor(conversationId: string, tabId: number): Promise<void> {
  try {
    const tab = await chrome.tabs.get(tabId);
    if (!tab.url) return;
    await recordDrivenTabFor(conversationId, { url: tab.url, title: tab.title ?? "", tabId });
  } catch {
    // The tab died during the run — nothing left to remember.
  }
}
