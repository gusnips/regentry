import { i18n } from "@/i18n";
import { buildConversationHistory, runAgentLoop } from ".";
import { extractAndRemember } from "@/modules/memory";
import {
  clearAgentWait,
  createDriver,
  focusTab,
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
import type { LastTab } from "@/modules/conversation/conversations";
import type { Message } from "@/modules/conversation/types";
import { defaultStartUrl } from "@/lib/prefs";
import { createLogger, truncate } from "@/lib/logger";
import type { Event } from "@/shared/protocol";
import { acquireRun, releaseRun } from "./active-runs";
import type { ActiveRun, RunOwner } from "./active-runs";
import type { PlanApprovalOutcome } from "./loop";
import { markRunningAwaiting, markRunningTab } from "./run-queue";

const log = createLogger("bg");

/** Holds the worker up through the post-run memory extraction — see start-run.ts. */
export const MEMORY_KEEPALIVE_ALARM = "tabrunner-memory-keepalive";

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
    // a tab of the run's own otherwise — dispatch-and-forget never hijacks what
    // the user is reading. An answer continues where the question arose: a
    // transcript parked on an unanswered ask_user goes back to the very tab the
    // conversation last drove, page state and all.
    const conversationTabs = await getConversationTabsFor(conversationId);
    const continuation = hasPendingQuestion(transcript) ? conversationTabs[0] : undefined;
    const target = await resolveRunTab(opts, continuation);
    if ("error" in target) {
      emit({ type: "error", message: target.error });
      return { ok: true };
    }
    const { tab, groupId, opened, adopted } = target;
    if (!tab.id) {
      emit({ type: "error", message: i18n.t("errors.noActiveTab") });
      return { ok: true };
    }
    markRunningTab(conversationId, tab.id);

    // The conversation may have worked on other pages than this run's start
    // (one run per message, and users move between messages). Name those tabs
    // so references like "that email" or "the doc" can find their way back
    // (rule 6 does the rest).
    const previousTabs = conversationTabs.filter((t) => t.url !== tab.url);

    log.info("run queued", {
      provider: providerConfig.name,
      model: providerConfig.model ?? "auto",
      tabId: tab.id,
      task: truncate(task, 120),
    });

    let endedOnQuestion = false;
    // How the run's tab group is retitled when it lets go — ✓, ? or ✗.
    let runFailed = false;
    // A plain "no" to a plan: nothing ran, so the tab this run opened for the
    // job is litter to take back rather than a result to keep.
    let planRejected = false;
    // A moving target: the run starts on the submit-time tab but the agent may
    // re-target itself with switch_tab — badge, panel chip and fail-fast all follow.
    let drivenTabId = tab.id;
    let drivenTitle = tabLabel(tab);
    const driver = createDriver(tab.id, {
      // A run that drives the user's own tab (this-page, or an adopted one) or
      // answers to a person watching may bring it forward; a run in a tab of its
      // own never pulls the window to itself.
      activateOnSwitch: opts.thisPage === true || adopted === true,
      onSwitch: (info) => {
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
      },
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
      emit({
        type: "error",
        message: i18n.t("errors.tabClosed", { title: drivenTitle }),
        silent: true,
      });
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
        conversationId,
        images,
        supportsImages: resolvedProvider?.supportsImages,
        history: history.length > 0 ? history : undefined,
        previousTabs: previousTabs.length > 0 ? previousTabs : undefined,
        mode: {
          background: opts.thisPage !== true,
          ...(adopted ? { adopted: true } : {}),
        },
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
                steps,
                reapproval,
                resolve: (approved, feedback) => {
                  const revision = approved ? undefined : feedback?.trim() || undefined;
                  // Approve or revise: the run works again, so the working marks
                  // return. A plain reject ends it — its unwind clears them.
                  if (approved || revision) {
                    markRunningAwaiting(conversationId, false);
                    void showAgentIndicator(drivenTabId, i18n.t("indicator.driving"));
                  } else {
                    planRejected = true;
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
          onError: (message, kind) => {
            runFailed = true;
            emit({ type: "error", message, kind });
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
      // But not unprotected: the board's keepalive alarm clears the moment this
      // run lets go of its slot, the panel has long closed itself, and an MV3
      // worker with nothing pending is killed mid-fetch — the extraction (and
      // the memory write) dies with it. A dedicated alarm holds the worker up
      // until the call settles; background.ts clears a stale one at boot.
      if (!run.controller.signal.aborted && resolvedProvider) {
        void chrome.alarms.create(MEMORY_KEEPALIVE_ALARM, { periodInMinutes: 0.5 });
        void extractAndRemember(resolvedProvider, wire, run.controller.signal).finally(() => {
          void chrome.alarms.clear(MEMORY_KEEPALIVE_ALARM);
        });
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
      // Runs whatever unwinds the loop — done, error, stop, question. A "no" to
      // the plan is the exception: nothing ran, so the tab the dispatch opened
      // goes away instead of settling into a ✗ group, and a page the agent only
      // glanced at is not where the conversation now lives.
      if (planRejected && opened) {
        await discardRunTab(tab.id);
      } else {
        await persistDrivenTabFor(conversationId, drivenTabId);
        await settleRunTab(
          groupId,
          task,
          runFailed ? "failed" : endedOnQuestion ? "question" : "done",
        );
      }
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

interface RunTab {
  tab: chrome.tabs.Tab;
  /** The run's tab group, when it owns one — retitled with the outcome on the way out. */
  groupId?: number;
  /** This run opened the tab, so a rejected plan can take it back. */
  opened?: boolean;
  /** This run took over the user's current tab — drive it, group it, never close it. */
  adopted?: boolean;
}

/** Last-resort start page when neither the task nor the preference names one. */
const FALLBACK_START_URL = "https://www.google.com";

/**
 * Pages that mean "no page" rather than "a page we were blocked from": the user
 * opened a tab and typed a task into it. Falling back to the start page is the
 * whole answer there — telling the model it was blocked would invent a page the
 * user never had.
 */
function isBlankPage(url: string | undefined): boolean {
  return !url || /^(about:blank|about:newtab|chrome:\/\/(newtab|new-tab-page))\/?$/i.test(url);
}

/**
 * Where the run drives. "this page" keeps the direct semantics — the window's
 * active tab, refused early when injection could never reach it, given a moment
 * to finish loading.
 *
 * The default panel run adopts that same tab: the state the task is about — the
 * half-filled form, the search results, the scrolled thread — lives there and
 * nowhere else, and re-visiting its url in a fresh tab would both lose it and
 * open a second live session the site may read as a bot. So the run takes the
 * tab as-is and the plan gate carries the "don't touch this" decision to the
 * user; the tab is grouped under the task's name so the user can see at a glance
 * that it's being driven, and it is never the run's to close.
 *
 * Only when there is no page to adopt — a blank/new-tab page, a page Chrome
 * forbids, an MCP client (nowhere near a browser), or an explicit target URL —
 * does the run open a tab of its own, on the start-page preference. A panel
 * run's own tab is brought forward once it's loaded and grouped: the user just
 * pressed send and is watching, and a run that fails to start takes its tab back
 * without the user ever seeing it blink past. Mid-run the driver's
 * `activateOnSwitch` keeps its hands off the window, so the run stops taking the
 * browser the moment the user turns to something else. An MCP client's run is
 * never revealed: nobody is at the browser, and reaching over to raise Chrome
 * over the editor they ARE looking at is the hijack this all avoids.
 */
async function resolveRunTab(
  opts: StartRunOptions,
  continuation?: LastTab,
): Promise<RunTab | { error: string }> {
  const reveal = opts.owner === "panel";
  if (opts.thisPage) {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) return { error: i18n.t("errors.noActiveTab") };
    if (isRestrictedUrl(tab.url)) return { error: i18n.t("errors.restrictedPage") };
    try {
      if (tab.status === "loading") await waitForLoad(tab.id, 10_000);
    } catch (e) {
      return { error: e instanceof Error ? e.message : String(e) };
    }
    // Every run is born backgrounded — even "this page" gets the task group, so
    // walking away (closing the panel) leaves the same labeled, blinking marker
    // a background run leaves. "Supervised" only ever meant the panel stays open.
    const groupId = await labelRunTab(tab.id, opts.task);
    return { tab, ...(groupId !== undefined ? { groupId } : {}) };
  }

  const reused = await reuseContinuationTab(continuation);
  if (reused) {
    if (reveal && reused.tab.id !== undefined) await focusTab(reused.tab.id, reused.tab.windowId);
    return reused;
  }

  // The default panel run works the tab the user is looking at — the state the
  // task is about (the half-filled form, the search results, the scrolled
  // thread) lives there and only there. Re-visiting its url in a fresh tab
  // would answer about a cold copy, and open a second live session the site
  // may read as a bot. Adoption takes the tab as-is; the run reads it and
  // proposes a plan before any action tool is unlocked, so "don't touch this
  // draft" is a plan rejection, not a fork.
  const adopt = reveal && !opts.url;
  if (adopt) {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab?.id && tab.url && !isBlankPage(tab.url) && !isRestrictedUrl(tab.url)) {
      try {
        if (tab.status === "loading") await waitForLoad(tab.id, 10_000);
      } catch (e) {
        return { error: e instanceof Error ? e.message : String(e) };
      }
      const groupId = await labelRunTab(tab.id, opts.task);
      return { tab, adopted: true, ...(groupId !== undefined ? { groupId } : {}) };
    }
  }

  const start = await resolveStartUrl(opts, continuation?.url);
  if (isRestrictedUrl(start.url)) return { error: i18n.t("errors.restrictedPage") };
  let tab: chrome.tabs.Tab;
  try {
    tab = await chrome.tabs.create({ active: false, url: start.url });
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
  // Loaded and grouped before it is shown: a run that never got off the ground
  // takes its tab back without the user ever having seen it blink past.
  if (reveal) await focusTab(tab.id, loaded.windowId);
  return {
    tab: loaded,
    opened: true,
    ...(groupId !== undefined ? { groupId } : {}),
  };
}

/**
 * The very tab the question was asked on, when it is still alive and still
 * there. Re-opening its url would also "continue where the question arose", but
 * a fresh load throws away the state the question was ABOUT — the half-filled
 * booking form, the search results, the scrolled thread. The group is adopted
 * only when it is the one that run created (its id was recorded alongside the
 * tab), so a tab the user has since filed into a group of their own keeps the
 * label they gave it.
 */
async function reuseContinuationTab(last: LastTab | undefined): Promise<RunTab | undefined> {
  if (last?.tabId === undefined) return undefined;
  try {
    const tab = await chrome.tabs.get(last.tabId);
    // A tab that has moved on is a different page with the same id.
    if (tab.url !== last.url || isRestrictedUrl(tab.url)) return undefined;
    return { tab, ...(tab.groupId === last.groupId ? { groupId: last.groupId } : {}) };
  } catch {
    // The tab died while the question waited — open a fresh one on its url.
    return undefined;
  }
}

/** The page a run's own tab opens on, and the page Chrome kept it from opening. */
async function resolveStartUrl(
  opts: StartRunOptions,
  continuationUrl: string | undefined,
): Promise<{ url: string }> {
  // Both name the page outright: the bridge's `url` argument, and a
  // continuation whose tab is gone but whose page is known.
  const named = opts.url || continuationUrl;
  if (named) return { url: named };

  // Only a panel run has a "page the user is on" — an MCP client is somewhere
  // else entirely, and its session starts on the neutral default. The panel
  // adoption path has already taken the user's tab when it could; reaching here
  // means that tab was blank or blocked, so the run opens its own on the
  // start-page preference (or the fallback), never a copy of a page it can't see.
  const url = (await defaultStartUrl.get()) || FALLBACK_START_URL;
  return { url };
}

/** Takes back a tab this run opened and never earned — best-effort, it may be gone. */
async function discardRunTab(tabId: number): Promise<void> {
  try {
    await chrome.tabs.remove(tabId);
  } catch {
    // Already closed — the group went with it.
  }
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
    await chrome.tabGroups.update(groupId, { title: groupTitle(task), color: "green" });
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
 * Remember the tab this run drove so the next run can spot a tab change — and
 * go back to the tab itself when it answers a question. The final state is read
 * fresh: navigations mid-run leave the start-time title, url and group stale.
 */
async function persistDrivenTabFor(conversationId: string, tabId: number): Promise<void> {
  try {
    const tab = await chrome.tabs.get(tabId);
    if (!tab.url) return;
    await recordDrivenTabFor(conversationId, {
      url: tab.url,
      title: tab.title ?? "",
      tabId,
      // Only a real group: TAB_GROUP_ID_NONE is -1, and reuse compares ids.
      ...(tab.groupId >= 0 ? { groupId: tab.groupId } : {}),
    });
  } catch {
    // The tab died during the run — nothing left to remember.
  }
}
