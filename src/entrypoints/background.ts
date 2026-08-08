import { initI18n, i18n } from "@/i18n";
import { runAgentLoop, buildConversationHistory } from "@/modules/agent";
import { extractAndRemember } from "@/modules/memory";
import {
  createDriver,
  showAgentIndicator,
  hideAgentIndicator,
  refreshAgentIndicator,
  waitAgentIndicator,
  clearAgentWait,
} from "@/modules/browser";
import { createProvider, getActiveProvider, resolveProviderModel } from "@/modules/providers";
import type { ResolvedProviderConfig } from "@/modules/providers/types";
import {
  appendMessage,
  getActiveId,
  getConversationTabs,
  getMessages,
  recordDrivenTab,
} from "@/modules/conversation";
import { createLogger, truncate } from "@/lib/logger";
import type { Command, Event } from "@/shared/protocol";
import { PORT_NAME } from "@/shared/protocol";

const log = createLogger("bg");

export default defineBackground(() => {
  void initI18n();
  log.debug("background initialized");

  chrome.runtime.onConnect.addListener((port) => {
    if (port.name !== PORT_NAME) return;
    log.debug("side panel connected");

    let abortController: AbortController | null = null;
    /** Messages typed mid-run; drained by the loop at each tool boundary. */
    const injectedQueue: { id: string; text: string }[] = [];

    port.onMessage.addListener(async (msg: Command) => {
      switch (msg.type) {
        case "run": {
          if (abortController) {
            send(port, { type: "error", message: i18n.t("errors.alreadyRunning") });
            return;
          }

          // Independent lookups — run them together; error precedence stays provider-first.
          const [providerConfig, [tab], transcript] = await Promise.all([
            getActiveProvider(),
            chrome.tabs.query({ active: true, currentWindow: true }),
            getActiveId().then((id) => (id ? getMessages(id) : [])),
          ]);
          if (!providerConfig) {
            send(port, {
              type: "error",
              message: i18n.t("errors.noActiveProvider"),
            });
            return;
          }

          if (!tab?.id) {
            send(port, { type: "error", message: i18n.t("errors.noActiveTab") });
            return;
          }

          // Resolve "auto" model to a concrete id at run start — mid-task
          // changes to the stored config never affect a run in flight.
          let provider;
          let resolvedProvider: ResolvedProviderConfig | undefined;
          try {
            resolvedProvider = await resolveProviderModel(providerConfig);
            provider = createProvider(resolvedProvider);
          } catch (e) {
            const message = e instanceof Error ? e.message : String(e);
            log.error("provider setup failed:", message);
            send(port, { type: "error", message });
            return;
          }

          // The user submitted from this window's active tab — but the conversation
          // may have worked elsewhere (one run per message, and users move between
          // messages). Name those tabs so references like "that email" or "the doc"
          // can find their way back (rule 6 does the rest).
          const previousTabs = tab.url
            ? (await getConversationTabs()).filter((t) => t.url !== tab.url)
            : [];

          log.info("run queued", {
            provider: providerConfig.name,
            model: providerConfig.model ?? "auto",
            tabId: tab.id,
            task: truncate(msg.task, 120),
          });

          // The run owns its controller: the shared `abortController` may already
          // name a newer run by the time this one unwinds (a stop redirect hands
          // off immediately), so the finally and the tab-gone listener must act on
          // this run's own instance, not the shared one.
          const runController = new AbortController();
          abortController = runController;
          injectedQueue.length = 0;
          let endedOnQuestion = false;
          // A moving target: the run starts on the submit-time tab but the
          // agent may re-target itself with switch_tab — badge, panel chip and
          // fail-fast all follow.
          let drivenTabId = tab.id;
          let drivenTitle = tabLabel(tab);
          const driver = createDriver(tab.id, (info) => {
            void hideAgentIndicator(drivenTabId);
            drivenTabId = info.id;
            drivenTitle = info.title;
            send(port, {
              type: "driving",
              tabId: info.id,
              windowId: info.windowId,
              title: info.title,
              favIconUrl: info.favIconUrl,
            });
            void showAgentIndicator(info.id, i18n.t("indicator.driving"));
          });
          // The panel is window-scoped and stays open on every tab — name the
          // tab this run actually drives, so the user can find their way to it.
          send(port, {
            type: "driving",
            tabId: drivenTabId,
            windowId: tab.windowId,
            title: drivenTitle,
            favIconUrl: tab.favIconUrl || undefined,
          });
          // The driven tab going away is fatal, not transient: every later tool
          // call would fail the same way. End the run with a clear error instead
          // of letting the model burn turns retrying a dead tab id.
          const onTabGone = (removedId: number) => {
            if (removedId !== drivenTabId) return;
            log.info("driven tab closed mid-run", { tabId: drivenTabId });
            send(port, {
              type: "error",
              message: i18n.t("errors.tabClosed", { title: drivenTitle }),
            });
            runController.abort();
          };
          chrome.tabs.onRemoved.addListener(onTabGone);
          // Tell the page itself it is being driven — the side panel may be
          // scrolled away or on another window.
          await clearAgentWait();
          chrome.notifications.clear("regentry-question");
          void showAgentIndicator(drivenTabId, i18n.t("indicator.driving"));

          // The stored conversation as wire turns — "continue" lands on a model
          // that has read the same exchange, not on a stranger.
          const history = buildConversationHistory(transcript);

          try {
            const wire = await runAgentLoop({
              provider,
              driver,
              task: msg.task,
              images: msg.images,
              supportsImages: resolvedProvider?.supportsImages,
              history: history.length > 0 ? history : undefined,
              previousTabs: previousTabs.length > 0 ? previousTabs : undefined,
              drainInjected: () => injectedQueue.splice(0, injectedQueue.length),
              signal: runController.signal,
              callbacks: {
                onInjected: (id, text) => send(port, { type: "injected", id, text }),
                onToken: (text) => send(port, { type: "token", text }),
                onReasoning: (text) => send(port, { type: "reasoning", text }),
                onStepStart: (tool, args) => send(port, { type: "step_start", tool, args }),
                onStep: (step) => send(port, { type: "step", ...step }),
                onPlan: (plan) => send(port, { type: "plan", ...plan }),
                onUsage: (input, output) => send(port, { type: "usage", input, output }),
                onError: (message) => send(port, { type: "error", message }),
                onDone: (summary) => send(port, { type: "done", summary }),
                onAskUser: (question) => {
                  endedOnQuestion = true;
                  void notifyIfAway(question);
                },
              },
            });
            // Memory is a background nicety: after a finished run, one cheap extra
            // call distills the durable facts the agent never got around to remembering.
            // Fire-and-forget — best-effort, a failed extraction never fails the run.
            if (!runController.signal.aborted && resolvedProvider) {
              void extractAndRemember(resolvedProvider, wire, runController.signal);
            }
          } catch (e) {
            const message = e instanceof Error ? e.message : String(e);
            log.error("run crashed:", message);
            send(port, { type: "error", message });
          } finally {
            chrome.tabs.onRemoved.removeListener(onTabGone);
            // Only clear if this run's controller is still the current one — a stop
            // redirect may have installed a newer run's controller already.
            if (abortController === runController) abortController = null;
            if (endedOnQuestion) void waitAgentIndicator(drivenTabId);
            else void hideAgentIndicator(drivenTabId);
            // Runs whatever unwinds the loop — done, error, stop, panel closed.
            void persistDrivenTab(drivenTabId);
          }
          break;
        }

        case "inject": {
          // Only meaningful mid-run; the panel routes idle-time input to `run`.
          if (abortController) injectedQueue.push({ id: msg.id, text: msg.text });
          break;
        }

        case "unqueue": {
          const i = injectedQueue.findIndex((q) => q.id === msg.id);
          if (i >= 0) injectedQueue.splice(i, 1);
          break;
        }

        case "stop": {
          log.info("stop requested");
          abortController?.abort();
          abortController = null;
          injectedQueue.length = 0;
          // Flush the partial stream immediately — the loop's own done arrives
          // as it unwinds and is a harmless no-op in the panel.
          send(port, { type: "done" });
          break;
        }

        case "ping": {
          // Heartbeat from the panel — receiving it keeps the worker alive
          // through long provider silences (reasoning models) and slow tools.
          break;
        }
      }
    });

    port.onDisconnect.addListener(() => {
      injectedQueue.length = 0;
      if (abortController) {
        abortController.abort();
        abortController = null;
        // Best-effort breadcrumb so a reopened panel doesn't read as if the
        // agent simply never replied — the worker may die before this lands.
        void appendMessage({
          id: crypto.randomUUID(),
          role: "step",
          tool: "interrupted",
          content: i18n.t("errors.panelClosed"),
          timestamp: Date.now(),
        });
      }
      log.debug("side panel disconnected");
    });
  });

  // Open side panel on action click
  chrome.action.onClicked.addListener(async (tab) => {
    if (tab.windowId !== undefined) {
      await chrome.sidePanel.open({ windowId: tab.windowId });
    }
  });

  // A load wipes the badge and the favicon dot. The navigate tool repaints
  // itself, but click-triggered navigations have no other hook — any load
  // completing in a driven tab puts its marks back. No-op for every other tab.
  chrome.tabs.onUpdated.addListener((tabId, info) => {
    if (info.status === "complete") void refreshAgentIndicator(tabId);
  });
});

function send(port: chrome.runtime.Port, event: Event) {
  try {
    port.postMessage(event);
  } catch {
    // Port closed
  }
}

/**
 * Remember the tab this run drove so the next run can spot a tab change.
 * The final state is read fresh — navigations mid-run leave the start-time
 * title and url stale.
 */
async function persistDrivenTab(tabId: number): Promise<void> {
  try {
    const tab = await chrome.tabs.get(tabId);
    if (!tab.url) return;
    await recordDrivenTab({ url: tab.url, title: tab.title ?? "", tabId });
  } catch {
    // The tab died during the run — nothing left to remember.
  }
}

/**
 * Fires an OS notification when a run ends on ask_user and the user is not
 * looking at a Chrome window — the strip "?" is invisible from another app.
 */
async function notifyIfAway(question: string): Promise<void> {
  try {
    const windows = await chrome.windows.getAll({ windowTypes: ["normal"] });
    if (windows.some((w) => w.focused)) return;
    void chrome.notifications.create("regentry-question", {
      type: "basic",
      iconUrl: "icon/128.png",
      title: "Regentry",
      message: truncate(question, 256),
    });
  } catch {
    // Notifications can fail silently — the strip mark still carries the signal.
  }
}

// Notification click opens the panel so the user can answer.
chrome.notifications.onClicked.addListener((id) => {
  if (id === "regentry-question") {
    chrome.notifications.clear("regentry-question");
    void chrome.windows.getLastFocused({ windowTypes: ["normal"] }).then((win) => {
      if (win.id) void chrome.sidePanel.open({ windowId: win.id });
    });
  }
});

/** Best human label for a tab — its title, then hostname, then nothing (the panel hides the chip). */
function tabLabel(tab: chrome.tabs.Tab): string {
  if (tab.title) return tab.title;
  try {
    return tab.url ? new URL(tab.url).hostname : "";
  } catch {
    return "";
  }
}
