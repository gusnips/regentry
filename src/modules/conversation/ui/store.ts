import { create } from "zustand";
import type { Command, Event } from "@/shared/protocol";
import { PORT_NAME } from "@/shared/protocol";
import type { Message, AgentStatus } from "../types";
import { getHistory, appendMessage, clearHistory } from "../history";

interface ConversationState {
  messages: Message[];
  status: AgentStatus;
  streamingText: string;
  /** Cumulative token usage for the current/last run */
  usage: { input: number; output: number };
  /** Epoch ms when the current run started (drives the elapsed display) */
  runStartedAt: number | null;

  connect: () => void;
  disconnect: () => void;
  sendTask: (task: string) => void;
  stop: () => void;
  clear: () => void;
}

let port: chrome.runtime.Port | null = null;
let msgCounter = 0;
/** Distinguishes "panel closed on purpose" from the worker dropping the port. */
let intentionalDisconnect = false;

function nextId(): string {
  return `m${Date.now()}-${++msgCounter}`;
}

function makeMsg(role: Message["role"], content: string, extra?: Partial<Message>): Message {
  return { id: nextId(), role, content, timestamp: Date.now(), ...extra };
}

export const useConversationStore = create<ConversationState>((set, get) => {
  const pushMsg = (msg: Message) => {
    set({ messages: [...get().messages, msg] });
    void appendMessage(msg);
  };

  const handleEvent = (event: Event) => {
    const s = get();
    switch (event.type) {
      case "token":
        set({ streamingText: s.streamingText + event.text });
        break;

      case "step":
        pushMsg(makeMsg("step", event.summary, { tool: event.tool, ok: event.ok }));
        break;

      case "usage":
        set({
          usage: { input: s.usage.input + event.input, output: s.usage.output + event.output },
        });
        break;

      case "error": {
        // Flush any partial stream first — it must not dangle as a ghost bubble.
        const partial = s.streamingText.trim();
        if (partial) pushMsg(makeMsg("assistant", partial));
        pushMsg(makeMsg("error", event.message));
        set({ streamingText: "", status: "error", runStartedAt: null });
        break;
      }

      case "done": {
        const text = s.streamingText.trim();
        if (text) {
          pushMsg(makeMsg("assistant", text));
        } else if (event.summary) {
          // Tool-only final turn — the done summary IS the answer.
          pushMsg(makeMsg("assistant", event.summary));
        }
        set({ streamingText: "", status: "idle", runStartedAt: null });
        break;
      }
    }
  };

  const attach = (): chrome.runtime.Port => {
    if (port) return port;
    intentionalDisconnect = false;
    const p = chrome.runtime.connect({ name: PORT_NAME });
    port = p;
    p.onMessage.addListener(handleEvent);
    p.onDisconnect.addListener(() => {
      port = null;
      if (intentionalDisconnect) {
        intentionalDisconnect = false;
        return;
      }
      // The worker dropped us (dev hot-reload, update, crash) — never silent.
      if (get().status === "running") {
        pushMsg(
          makeMsg(
            "error",
            "Connection to the agent was lost — the run stopped. Send the task again to retry.",
          ),
        );
      }
      set({ streamingText: "", status: "idle", runStartedAt: null });
    });
    return p;
  };

  return {
    messages: [],
    status: "idle",
    streamingText: "",
    usage: { input: 0, output: 0 },
    runStartedAt: null,

    connect: () => {
      if (port) return;
      void getHistory().then((messages) => set({ messages }));
      attach();
    },

    disconnect: () => {
      if (!port) return;
      intentionalDisconnect = true;
      port.disconnect();
      port = null;
    },

    sendTask: (task) => {
      if (get().status === "running") return;
      // The port dies with the worker — reconnect lazily instead of eating the task.
      let p: chrome.runtime.Port;
      try {
        p = attach();
      } catch {
        pushMsg(
          makeMsg("error", "Regent was reloaded — close and reopen this panel to keep going."),
        );
        return;
      }
      pushMsg(makeMsg("user", task));
      set({
        status: "running",
        streamingText: "",
        usage: { input: 0, output: 0 },
        runStartedAt: Date.now(),
      });
      p.postMessage({ type: "run", task } satisfies Command);
    },

    stop: () => {
      port?.postMessage({ type: "stop" } satisfies Command);
      set({ status: "idle", runStartedAt: null });
    },

    clear: () => {
      void clearHistory();
      set({
        messages: [],
        streamingText: "",
        status: "idle",
        usage: { input: 0, output: 0 },
        runStartedAt: null,
      });
    },
  };
});
