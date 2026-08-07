import { runAgentLoop } from "@/modules/agent";
import { createDriver } from "@/modules/browser";
import { createProvider, getActiveProvider } from "@/modules/providers";
import { log } from "@/lib/logger";
import type { Command, Event } from "@/shared/protocol";
import { PORT_NAME } from "@/shared/protocol";

export default defineBackground(() => {
  log.debug("background initialized");

  chrome.runtime.onConnect.addListener((port) => {
    if (port.name !== PORT_NAME) return;
    log.debug("side panel connected");

    let abortController: AbortController | null = null;

    port.onMessage.addListener(async (msg: Command) => {
      switch (msg.type) {
        case "run": {
          if (abortController) {
            send(port, { type: "error", message: "A task is already running. Stop it first." });
            return;
          }

          const providerConfig = await getActiveProvider();
          if (!providerConfig) {
            send(port, {
              type: "error",
              message: "No provider configured. Add one in Settings.",
            });
            return;
          }

          const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
          if (!tab?.id) {
            send(port, { type: "error", message: "No active tab found." });
            return;
          }

          abortController = new AbortController();
          const provider = createProvider(providerConfig);
          const driver = createDriver(tab.id);

          send(port, { type: "token", text: `Starting: ${msg.task}\n\n` });

          try {
            await runAgentLoop({
              provider,
              driver,
              task: msg.task,
              signal: abortController.signal,
              callbacks: {
                onToken: (text) => send(port, { type: "token", text }),
                onStep: (tool, summary) => send(port, { type: "step", tool, summary }),
                onToolCall: (tool, args) => send(port, { type: "tool_call", tool, args }),
                onToolResult: (tool, ok, detail) =>
                  send(port, { type: "tool_result", tool, ok, detail }),
                onUsage: (input, output) => send(port, { type: "usage", input, output }),
                onError: (message) => send(port, { type: "error", message }),
                onDone: () => send(port, { type: "done" }),
              },
            });
          } catch (e) {
            const message = e instanceof Error ? e.message : String(e);
            send(port, { type: "error", message });
          } finally {
            abortController = null;
          }
          break;
        }

        case "stop": {
          abortController?.abort();
          abortController = null;
          send(port, { type: "done" });
          break;
        }

        case "pause": {
          // ponytail: pause not implemented in v1 — abort acts as stop.
          // Upgrade: track promise, resume by re-streaming with stored messages.
          log.debug("pause received — not yet implemented, use stop");
          break;
        }
      }
    });

    port.onDisconnect.addListener(() => {
      abortController?.abort();
      abortController = null;
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
