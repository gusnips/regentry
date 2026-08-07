import { create } from "zustand";
import { i18n } from "@/i18n";
import type { Command, Event } from "@/shared/protocol";
import { PORT_NAME } from "@/shared/protocol";
import type { Message, AgentStatus } from "../types";
import { getHistory, appendMessage, clearHistory } from "../history";
import { toolVerbKey } from "./tool-labels";

interface ConversationState {
  messages: Message[];
  status: AgentStatus;
  streamingText: string;
  /** Model reasoning stream for the current run (display-only, flushed at the next step or turn end) */
  reasoningText: string;
  /** Cumulative token usage for the current/last run */
  usage: { input: number; output: number };
  /** Epoch ms when the current run started (drives the elapsed display) */
  runStartedAt: number | null;
  /** Last task sent — powers the Retry action on transient errors */
  lastTask: string | null;
  /** Id of the in-flight tool's live row (never persisted) */
  pendingStepId: string | null;

  connect: () => void;
  disconnect: () => void;
  sendTask: (task: string) => void;
  retry: () => void;
  stop: () => void;
  clear: () => void;
}

let port: chrome.runtime.Port | null = null;
let msgCounter = 0;
/** Distinguishes "panel closed on purpose" from the worker dropping the port. */
let intentionalDisconnect = false;
/** Panel → worker heartbeat: any port traffic resets the MV3 worker's idle timer,
 *  so long tool calls and slow reasoning streams can't kill it mid-run. */
let pingTimer: ReturnType<typeof setInterval> | null = null;

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

  /** Persist accumulated reasoning as its own block, in transcript order. */
  const flushReasoning = () => {
    const reasoning = get().reasoningText.trim();
    if (reasoning) pushMsg(makeMsg("reasoning", reasoning));
    set({ reasoningText: "" });
  };

  /** A run that ends with a tool in flight must not leave its row spinning. */
  const settleLive = (msgs: Message[]) => msgs.map((m) => (m.live ? { ...m, live: false } : m));

  const startRun = (p: chrome.runtime.Port, task: string) => {
    set({
      status: "running",
      streamingText: "",
      reasoningText: "",
      usage: { input: 0, output: 0 },
      runStartedAt: Date.now(),
      lastTask: task,
      pendingStepId: null,
    });
    p.postMessage({ type: "run", task } satisfies Command);
  };

  const handleEvent = (event: Event) => {
    const s = get();
    switch (event.type) {
      case "token":
        set({ streamingText: s.streamingText + event.text });
        break;

      case "reasoning":
        set({ reasoningText: s.reasoningText + event.text });
        break;

      case "step_start": {
        flushReasoning();
        const key = toolVerbKey(event.tool);
        const msg = makeMsg("step", key ? `${i18n.t(key)}…` : "…", {
          tool: event.tool,
          live: true,
        });
        // Live rows are in-memory only — persisted once the tool finishes.
        set({ messages: [...get().messages, msg], pendingStepId: msg.id });
        break;
      }

      case "step": {
        flushReasoning();
        const pending = get().pendingStepId;
        if (pending) {
          // Settle the live row in place, then persist the finished step.
          const msgs = get().messages.map((m) =>
            m.id === pending ? { ...m, content: event.summary, ok: event.ok, live: false } : m,
          );
          set({ messages: msgs, pendingStepId: null });
          const settled = msgs.find((m) => m.id === pending);
          if (settled) void appendMessage(settled);
        } else {
          pushMsg(makeMsg("step", event.summary, { tool: event.tool, ok: event.ok }));
        }
        break;
      }

      case "usage":
        set({
          usage: { input: s.usage.input + event.input, output: s.usage.output + event.output },
        });
        break;

      case "error": {
        // Flush any partial streams first — they must not dangle as ghost bubbles.
        flushReasoning();
        const partial = s.streamingText.trim();
        if (partial) pushMsg(makeMsg("assistant", partial));
        pushMsg(makeMsg("error", event.message));
        set((st) => ({
          messages: settleLive(st.messages),
          streamingText: "",
          status: "error",
          runStartedAt: null,
          pendingStepId: null,
        }));
        break;
      }

      case "done": {
        flushReasoning();
        const text = s.streamingText.trim();
        if (text) {
          pushMsg(makeMsg("assistant", text));
        } else if (event.summary) {
          // Tool-only final turn — the done summary IS the answer.
          pushMsg(makeMsg("assistant", event.summary));
        }
        set((st) => ({
          messages: settleLive(st.messages),
          streamingText: "",
          status: "idle",
          runStartedAt: null,
          pendingStepId: null,
        }));
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
      if (pingTimer) {
        clearInterval(pingTimer);
        pingTimer = null;
      }
      if (intentionalDisconnect) {
        intentionalDisconnect = false;
        return;
      }
      // The worker dropped us (dev hot-reload, update, crash) — never silent.
      if (get().status === "running") {
        pushMsg(makeMsg("error", i18n.t("chat.portLost")));
      }
      set((st) => ({
        messages: settleLive(st.messages),
        streamingText: "",
        reasoningText: "",
        status: "idle",
        runStartedAt: null,
        pendingStepId: null,
      }));
    });
    pingTimer ??= setInterval(() => {
      try {
        port?.postMessage({ type: "ping" } satisfies Command);
      } catch {
        // Port already gone — onDisconnect clears the timer.
      }
    }, 25_000);
    return p;
  };

  return {
    messages: [],
    status: "idle",
    streamingText: "",
    reasoningText: "",
    usage: { input: 0, output: 0 },
    runStartedAt: null,
    lastTask: null,
    pendingStepId: null,

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
      if (pingTimer) {
        clearInterval(pingTimer);
        pingTimer = null;
      }
    },

    sendTask: (task) => {
      if (get().status === "running") return;
      // The port dies with the worker — reconnect lazily instead of eating the task.
      let p: chrome.runtime.Port;
      try {
        p = attach();
      } catch {
        pushMsg(makeMsg("error", i18n.t("chat.reloaded")));
        return;
      }
      pushMsg(makeMsg("user", task));
      startRun(p, task);
    },

    retry: () => {
      const task = get().lastTask;
      if (!task || get().status === "running") return;
      // No duplicate user row — the failed attempt sits right above.
      let p: chrome.runtime.Port;
      try {
        p = attach();
      } catch {
        pushMsg(makeMsg("error", i18n.t("chat.reloaded")));
        return;
      }
      startRun(p, task);
    },

    stop: () => {
      port?.postMessage({ type: "stop" } satisfies Command);
      set((st) => ({
        messages: settleLive(st.messages),
        status: "idle",
        runStartedAt: null,
        pendingStepId: null,
      }));
    },

    clear: () => {
      void clearHistory();
      set({
        messages: [],
        streamingText: "",
        reasoningText: "",
        status: "idle",
        usage: { input: 0, output: 0 },
        runStartedAt: null,
        lastTask: null,
        pendingStepId: null,
      });
    },
  };
});
