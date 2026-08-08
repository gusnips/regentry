import { i18n } from "@/i18n";
import { buildConversationHistory, runAgentLoop } from ".";
import { extractAndRemember } from "@/modules/memory";
import {
  clearAgentWait,
  createDriver,
  hideAgentIndicator,
  showAgentIndicator,
  waitAgentIndicator,
} from "@/modules/browser";
import { createProvider, getActiveProvider, resolveProviderModel } from "@/modules/providers";
import type { ResolvedProviderConfig } from "@/modules/providers/types";
import { getConversationTabsFor, getMessages, recordDrivenTabFor } from "@/modules/conversation";
import { createLogger, truncate } from "@/lib/logger";
import type { Event } from "@/shared/protocol";
import { acquireRun, releaseRun } from "./active-runs";
import type { ActiveRun, RunOwner } from "./active-runs";

const log = createLogger("bg");

export interface StartRunOptions {
  /** The conversation this run's transcript lives in — the panel's active one,
   *  or the bridge's dedicated MCP thread. */
  conversationId: string;
  owner: RunOwner;
  task: string;
  images?: string[];
  /** Streams run events to the client — the panel port or the bridge's WS. */
  emit: (event: Event) => void;
  /** The run ended on an ask_user question; the client may want to react
   *  (the panel fires an OS notification, the bridge records a pending answer). */
  onAskUser?: (question: string) => void;
}

export type StartRunResult = { ok: true } | { ok: false; active: ActiveRun };

/**
 * The full run-start flow, shared by the panel port and the MCP bridge: claim
 * the single run slot, resolve provider + active tab, drive the loop, distill
 * memory, persist the driven tab. A conflict is returned (never swallowed) so
 * each caller can word it for its own audience.
 */
export async function startAgentRun(opts: StartRunOptions): Promise<StartRunResult> {
  const { conversationId, owner, task, images, emit, onAskUser } = opts;
  const claim = acquireRun(conversationId, owner);
  if (!claim.ok) return { ok: false, active: claim.active };
  const { run } = claim;

  try {
    // Independent lookups — run them together; error precedence stays provider-first.
    const [providerConfig, [tab], transcript] = await Promise.all([
      getActiveProvider(),
      chrome.tabs.query({ active: true, currentWindow: true }),
      getMessages(conversationId),
    ]);
    if (!providerConfig) {
      emit({ type: "error", message: i18n.t("errors.noActiveProvider") });
      return { ok: true };
    }
    if (!tab?.id) {
      emit({ type: "error", message: i18n.t("errors.noActiveTab") });
      return { ok: true };
    }

    // Resolve "auto" model to a concrete id at run start — mid-task changes to
    // the stored config never affect a run in flight.
    let provider;
    let resolvedProvider: ResolvedProviderConfig | undefined;
    try {
      resolvedProvider = await resolveProviderModel(providerConfig);
      provider = createProvider(resolvedProvider);
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      log.error("provider setup failed:", message);
      emit({ type: "error", message });
      return { ok: true };
    }

    // The task was submitted from this window's active tab — but the conversation
    // may have worked elsewhere (one run per message, and users move between
    // messages). Name those tabs so references like "that email" or "the doc"
    // can find their way back (rule 6 does the rest).
    const previousTabs = tab.url
      ? (await getConversationTabsFor(conversationId)).filter((t) => t.url !== tab.url)
      : [];

    log.info("run queued", {
      provider: providerConfig.name,
      model: providerConfig.model ?? "auto",
      tabId: tab.id,
      task: truncate(task, 120),
    });

    let endedOnQuestion = false;
    // A moving target: the run starts on the submit-time tab but the agent may
    // re-target itself with switch_tab — badge, panel chip and fail-fast all follow.
    let drivenTabId = tab.id;
    let drivenTitle = tabLabel(tab);
    const driver = createDriver(tab.id, (info) => {
      void hideAgentIndicator(drivenTabId);
      drivenTabId = info.id;
      drivenTitle = info.title;
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
      emit({ type: "error", message: i18n.t("errors.tabClosed", { title: drivenTitle }) });
      run.controller.abort();
    };
    chrome.tabs.onRemoved.addListener(onTabGone);
    // Tell the page itself it is being driven — the side panel may be scrolled
    // away or on another window.
    await clearAgentWait();
    chrome.notifications.clear("regentry-question");
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
          onUsage: (input, output) => emit({ type: "usage", input, output }),
          onError: (message) => emit({ type: "error", message }),
          onDone: (summary) => emit({ type: "done", summary }),
          onAskUser: (question) => {
            endedOnQuestion = true;
            onAskUser?.(question);
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
      emit({ type: "error", message });
    } finally {
      chrome.tabs.onRemoved.removeListener(onTabGone);
      if (endedOnQuestion) void waitAgentIndicator(drivenTabId);
      else void hideAgentIndicator(drivenTabId);
      // Runs whatever unwinds the loop — done, error, stop, panel closed.
      await persistDrivenTabFor(conversationId, drivenTabId);
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
