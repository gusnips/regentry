import { initI18n, i18n } from "@/i18n";
import { runAgentLoop } from "@/modules/agent";
import { createDriver } from "@/modules/browser";
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

    port.onMessage.addListener(async (msg: Command) => {
      switch (msg.type) {
        case "run": {
          if (abortController) {
            send(port, { type: "error", message: i18n.t("errors.alreadyRunning") });
            return;
          }

          const providerConfig = await getActiveProvider();
          if (!providerConfig) {
            send(port, {
              type: "error",
              message: i18n.t("errors.noActiveProvider"),
            });
            return;
          }

          const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
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
          const driver = createDriver(tab.id);

          try {
            await runAgentLoop({
              provider,
              driver,
              task: msg.task,
              signal: abortController.signal,
              callbacks: {
                onToken: (text) => send(port, { type: "token", text }),
                onReasoning: (text) => send(port, { type: "reasoning", text }),
                onStepStart: (tool) => send(port, { type: "step_start", tool }),
                onStep: (tool, summary, ok) => send(port, { type: "step", tool, summary, ok }),
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
            abortController = null;
          }
          break;
        }

        case "stop": {
          log.info("stop requested");
          abortController?.abort();
          abortController = null;
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
      if (abortController) {
        abortController.abort();
        abortController = null;
        // Best-effort breadcrumb so a reopened panel doesn't read as if the
        // agent simply never replied — the worker may die before this lands.
        void appendMessage({
          id: `m${Date.now()}-bg`,
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
