import { create } from "zustand";
import type { Command, Event } from "@/shared/protocol";
import { PORT_NAME } from "@/shared/protocol";
import type { Message, AgentStatus } from "../types";
import { getHistory, appendMessage, clearHistory } from "../history";

interface ConversationState {
  messages: Message[];
  status: AgentStatus;
  streamingText: string;
  error: string | null;

  connect: () => void;
  disconnect: () => void;
  sendTask: (task: string) => void;
  stop: () => void;
  clear: () => void;
}

let port: chrome.runtime.Port | null = null;
let msgCounter = 0;

function nextId(): string {
  return `m${Date.now()}-${++msgCounter}`;
}

export const useConversationStore = create<ConversationState>((set, get) => ({
  messages: [],
  status: "idle",
  streamingText: "",
  error: null,

  connect: () => {
    if (port) return;

    // Load persisted history
    void getHistory().then((messages) => set({ messages }));

    port = chrome.runtime.connect({ name: PORT_NAME });

    port.onMessage.addListener((event: Event) => {
      const s = get();
      switch (event.type) {
        case "token":
          set({ streamingText: s.streamingText + event.text });
          break;

        case "step": {
          const msg: Message = {
            id: nextId(),
            role: "step",
            content: event.summary,
            tool: event.tool,
            timestamp: Date.now(),
          };
          set({ messages: [...s.messages, msg] });
          void appendMessage(msg);
          break;
        }

        case "error": {
          const msg: Message = {
            id: nextId(),
            role: "error",
            content: event.message,
            timestamp: Date.now(),
          };
          set({ messages: [...s.messages, msg], status: "error", error: event.message });
          void appendMessage(msg);
          break;
        }

        case "done": {
          // Flush streaming text into a message
          const text = s.streamingText.trim();
          const msgs = [...s.messages];
          if (text) {
            const msg: Message = {
              id: nextId(),
              role: "assistant",
              content: text,
              timestamp: Date.now(),
            };
            msgs.push(msg);
            void appendMessage(msg);
          }
          set({ messages: msgs, streamingText: "", status: "idle" });
          break;
        }

        case "tool_call":
        case "tool_result":
          // Folded into step events — no separate handling needed
          break;
      }
    });

    port.onDisconnect.addListener(() => {
      port = null;
      set({ streamingText: "", status: "idle" });
    });
  },

  disconnect: () => {
    port?.disconnect();
    port = null;
  },

  sendTask: (task: string) => {
    if (!port || get().status === "running") return;
    const msg: Message = { id: nextId(), role: "user", content: task, timestamp: Date.now() };
    set((s) => ({
      messages: [...s.messages, msg],
      status: "running",
      error: null,
      streamingText: "",
    }));
    void appendMessage(msg);
    port.postMessage({ type: "run", task } satisfies Command);
  },

  stop: () => {
    port?.postMessage({ type: "stop" } satisfies Command);
    set({ status: "idle" });
  },

  clear: () => {
    void clearHistory();
    set({ messages: [], streamingText: "", error: null, status: "idle" });
  },
}));
