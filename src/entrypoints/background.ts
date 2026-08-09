import { initI18n, i18n } from "@/i18n";
import { startAgentRun } from "@/modules/agent/start-run";
import { getActiveRun, releaseRun } from "@/modules/agent/active-runs";
import type { ActiveRun } from "@/modules/agent/active-runs";
import { appendMessage, getActiveId } from "@/modules/conversation";
import { refreshAgentIndicator } from "@/modules/browser";
import { initProviderOriginStrip } from "@/modules/providers/origin";
import { createLogger, truncate } from "@/lib/logger";
import type { Command, Event } from "@/shared/protocol";
import { PORT_NAME } from "@/shared/protocol";
import { getBridge, startBridge } from "@/modules/bridge";

const log = createLogger("bg");
/** Every open panel — an external agent starting work must reach them all. */
const panelPorts = new Set<chrome.runtime.Port>();

export default defineBackground(() => {
  void initI18n();
  // Strip Origin from our own provider calls, or a subscription OAuth token is
  // refused by Anthropic's CORS gate before any model code ever runs.
  initProviderOriginStrip();
  // The MCP bridge — a WS client to the local daemon so external AI clients can
  // drive the same loop. Reconnects on its own reconcile alarm; harmless when
  // no daemon is listening. Activity changes are broadcast to open panels: the
  // run is already blinking the driven tab's favicon, the panel just names it.
  startBridge((active) => {
    for (const p of panelPorts) send(p, { type: "run_active", active });
  });
  log.debug("background initialized");

  chrome.runtime.onConnect.addListener((port) => {
    if (port.name !== PORT_NAME) return;
    log.debug("side panel connected");
    panelPorts.add(port);

    port.onMessage.addListener(async (msg: Command) => {
      switch (msg.type) {
        case "run": {
          // The panel's task message was stored (and its id adopted) before the
          // run command left — so the active conversation is this run's home.
          const conversationId = (await getActiveId()) ?? crypto.randomUUID();
          const result = await startAgentRun({
            conversationId,
            owner: "panel",
            task: msg.task,
            images: msg.images,
            emit: (event) => send(port, event),
            onAskUser: (question) => void notifyIfAway(question),
          });
          if (!result.ok) {
            send(port, { type: "error", message: alreadyRunningMessage(result.active) });
          }
          break;
        }

        case "inject": {
          // Only meaningful mid-run; the panel routes idle-time input to `run`.
          const run = getActiveRun();
          if (run?.owner === "panel") run.injectedQueue.push({ id: msg.id, text: msg.text });
          break;
        }

        case "unqueue": {
          const run = getActiveRun();
          if (run?.owner !== "panel") break;
          const i = run.injectedQueue.findIndex((q) => q.id === msg.id);
          if (i >= 0) run.injectedQueue.splice(i, 1);
          break;
        }

        case "stop": {
          const run = getActiveRun();
          if (run?.owner === "panel") {
            run.controller.abort();
            run.injectedQueue.length = 0;
            releaseRun(run);
          } else if (run?.owner === "bridge") {
            // The panel's Stop on an external run — the same mechanics as the
            // bridge's own stop, routed here so the user can reclaim the browser.
            getBridge()?.stopFromPanel();
          }
          // Flush the partial stream immediately — the loop's own done arrives
          // as it unwinds and is a harmless no-op in the panel.
          send(port, { type: "done" });
          break;
        }

        case "query_run": {
          // Answer fresh on connect — the broadcast may have happened while the
          // panel was closed, and stale state must never read as "browser idle".
          send(port, { type: "run_active", active: getBridge()?.activity ?? null });
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
      panelPorts.delete(port);
      const run = getActiveRun();
      if (run?.owner === "panel") {
        run.controller.abort();
        run.injectedQueue.length = 0;
        releaseRun(run);
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

/** alreadyRunning text naming who holds the slot — the panel reader needs to know. */
function alreadyRunningMessage(run: ActiveRun): string {
  return run.owner === "bridge"
    ? i18n.t("errors.alreadyRunningBridge")
    : i18n.t("errors.alreadyRunning");
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
