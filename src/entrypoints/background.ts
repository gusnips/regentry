import { initI18n, i18n } from "@/i18n";
import { runAgentLoop } from "@/modules/agent";
import { createDriver, showAgentIndicator, hideAgentIndicator } from "@/modules/browser";
import { createProvider, getActiveProvider, resolveProviderModel } from "@/modules/providers";
import { appendMessage } from "@/modules/conversation";
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
          const [providerConfig, [tab]] = await Promise.all([
            getActiveProvider(),
            chrome.tabs.query({ active: true, currentWindow: true }),
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
          try {
            provider = createProvider(await resolveProviderModel(providerConfig));
          } catch (e) {
            const message = e instanceof Error ? e.message : String(e);
            log.error("provider setup failed:", message);
            send(port, { type: "error", message });
            return;
          }

          log.info("run queued", {
            provider: providerConfig.name,
            model: providerConfig.model ?? "auto",
            tabId: tab.id,
            task: truncate(msg.task, 120),
          });

          abortController = new AbortController();
          injectedQueue.length = 0;
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
            abortController?.abort();
          };
          chrome.tabs.onRemoved.addListener(onTabGone);
          // Tell the page itself it is being driven — the side panel may be
          // scrolled away or on another window.
          void showAgentIndicator(drivenTabId, i18n.t("indicator.driving"));

          try {
            await runAgentLoop({
              provider,
              driver,
              task: msg.task,
              images: msg.images,
              drainInjected: () => injectedQueue.splice(0, injectedQueue.length),
              signal: abortController.signal,
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
              },
            });
          } catch (e) {
            const message = e instanceof Error ? e.message : String(e);
            log.error("run crashed:", message);
            send(port, { type: "error", message });
          } finally {
            chrome.tabs.onRemoved.removeListener(onTabGone);
            abortController = null;
            void hideAgentIndicator(drivenTabId);
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
});

function send(port: chrome.runtime.Port, event: Event) {
  try {
    port.postMessage(event);
  } catch {
    // Port closed
  }
}

/** Best human label for a tab — its title, then hostname, then nothing (the panel hides the chip). */
function tabLabel(tab: chrome.tabs.Tab): string {
  if (tab.title) return tab.title;
  try {
    return tab.url ? new URL(tab.url).hostname : "";
  } catch {
    return "";
  }
}
