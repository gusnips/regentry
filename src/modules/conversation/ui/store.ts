import { create } from "zustand";
import { i18n } from "@/i18n";
import type { Command, DrivingPayload, Event } from "@/shared/protocol";
import { PORT_NAME } from "@/shared/protocol";
import type { Message, AgentStatus } from "../types";
import type { ConversationMeta } from "../conversations";
import {
  appendMessage,
  deleteConversation,
  getActiveId,
  getMessages,
  listConversations,
  replaceMessage,
  setActiveConversation,
  watchConversations,
} from "../conversations";
import { toolVerbKey } from "./tool-labels";

interface ConversationState {
  messages: Message[];
  /** Stored transcripts, most recently touched first — powers the history list */
  conversations: ConversationMeta[];
  /** Open conversation; null until the first message of a fresh one is stored */
  activeId: string | null;
  status: AgentStatus;
  streamingText: string;
  /** Model reasoning stream for the current run (display-only, flushed at the next step or turn end) */
  reasoningText: string;
  /** Epoch ms when the open reasoning segment began — powers its "for 3m 48s" clock */
  reasoningStartedAt: number | null;
  /** Cumulative token usage for the current/last run */
  usage: { input: number; output: number };
  /** Epoch ms when the current run started (drives the elapsed display) */
  runStartedAt: number | null;
  /** Epoch ms when it finished — keeps the summary line up after the run ends */
  runEndedAt: number | null;
  /** Last run's input — powers the Retry action on transient errors */
  lastRun: { task: string; images?: string[] } | null;
  /** Id of the in-flight tool's live row (never persisted) */
  pendingStepId: string | null;
  /** Id of this run's plan card — updates rewrite it rather than stacking copies */
  planMsgId: string | null;
  /** Messages typed mid-run, waiting for the next tool boundary. */
  queued: { id: string; text: string }[];
  /** Joined queued text waiting to auto-run once the current run fully unwinds (a stop redirect). */
  pendingSend: string | null;
  /** The composer's text, so a recalled queue or an ending run can hand text back to it. */
  draft: string;
  /** The tab the current run is driving; null when idle. */
  drivingTab: DrivingPayload | null;

  connect: () => void;
  disconnect: () => void;
  sendTask: (task: string, images?: string[]) => void;
  queueMessage: (text: string) => void;
  unqueueMessage: (id: string) => void;
  /** ↑-arrow recall: the newest queued message goes back to the composer. */
  recallQueued: () => void;
  setDraft: (text: string) => void;
  retry: () => void;
  stop: () => void;
  /** Start a fresh transcript — the current one stays in history */
  newConversation: () => void;
  openConversation: (id: string) => void;
  removeConversation: (id: string) => void;
}

let port: chrome.runtime.Port | null = null;
/** Distinguishes "panel closed on purpose" from the worker dropping the port. */
let intentionalDisconnect = false;
/** Panel → worker heartbeat: any port traffic resets the MV3 worker's idle timer,
 *  so long tool calls and slow reasoning streams can't kill it mid-run. */
let pingTimer: ReturnType<typeof setInterval> | null = null;
/** Storage watch on the conversation index — background appends land here too. */
let unwatchConversations: (() => void) | null = null;
/** Did this run stream any prose? Governs done-summary dedup, never its display. */
let sawAssistantText = false;

function makeMsg(role: Message["role"], content: string, extra?: Partial<Message>): Message {
  return { id: crypto.randomUUID(), role, content, timestamp: Date.now(), ...extra };
}

/** Case/whitespace/trailing-punctuation-blind equality — enough to spot a
 * summary repeating streamed prose verbatim. Deliberately conservative: a
 * dedup that swallows a genuinely different summary re-creates the silence. */
function sameText(a: string, b: string): boolean {
  const norm = (s: string) =>
    s
      .trim()
      .replace(/[.!?…,:;]+$/, "")
      .replace(/\s+/g, " ")
      .toLowerCase();
  return norm(a) === norm(b);
}

/**
 * The done summary is the run's closing word — the user must never be left
 * without one. Dropping it whenever ANY prose streamed (the old gate) made
 * runs end silent the moment the model spent a one-liner mid-way; only a
 * verbatim repeat of prose already shown adds nothing.
 */
export function closingSummary(
  sawProse: boolean,
  lastProse: string | undefined,
  summary: string | undefined,
): string | null {
  const text = summary?.trim();
  if (!text) return null;
  if (sawProse && lastProse !== undefined && sameText(lastProse, text)) return null;
  return text;
}

export const useConversationStore = create<ConversationState>((set, get) => {
  /** Resolves once the message is stored — awaited only where ordering matters. */
  const pushMsg = (msg: Message): Promise<void> => {
    set({ messages: [...get().messages, msg] });
    // A fresh conversation is created by the first append — adopt its id.
    return appendMessage(msg).then((id) => {
      if (get().activeId !== id) set({ activeId: id });
    });
  };

  /** Transcript-independent state — reset whenever the panel switches transcripts. */
  const resetRun = () => ({
    streamingText: "",
    reasoningText: "",
    reasoningStartedAt: null,
    status: "idle" as AgentStatus,
    usage: { input: 0, output: 0 },
    runStartedAt: null,
    runEndedAt: null,
    lastRun: null,
    pendingStepId: null,
    planMsgId: null,
    queued: [],
    pendingSend: null,
    draft: "",
    drivingTab: null,
  });

  /**
   * Reasoning and text are separate segments closed at the point the other one
   * starts, so a run reads in the order it happened: think, say, act, think
   * again. Accumulating either across a whole run would pile every thought into
   * one block sitting where the first one opened.
   *
   * Because each flushes the other, at most one is ever non-empty — which is
   * why the flush pairs below can run in either order.
   */
  const flushReasoning = () => {
    const reasoning = get().reasoningText.trim();
    const startedAt = get().reasoningStartedAt;
    if (reasoning) {
      pushMsg(
        makeMsg(
          "reasoning",
          reasoning,
          startedAt ? { elapsed: Date.now() - startedAt } : undefined,
        ),
      );
    }
    set({ reasoningText: "", reasoningStartedAt: null });
  };

  const flushStreaming = () => {
    const text = get().streamingText.trim();
    if (text) {
      sawAssistantText = true;
      pushMsg(makeMsg("assistant", text));
    }
    set({ streamingText: "" });
  };

  /** A run that ends with a tool in flight must not leave its row spinning. */
  const settleLive = (msgs: Message[]) => msgs.map((m) => (m.live ? { ...m, live: false } : m));

  /**
   * The one run-end transition — error, done, and a lost port all land here.
   * runStartedAt survives so the summary line can still say how long it went.
   */
  const settleRun = (status: AgentStatus) =>
    set((st) => ({
      messages: settleLive(st.messages),
      streamingText: "",
      reasoningText: "",
      reasoningStartedAt: null,
      status,
      runEndedAt: Date.now(),
      pendingStepId: null,
      drivingTab: null,
    }));

  /** Recall a text into the composer, preserving anything already there. */
  const mergeIntoDraft = (text: string) => {
    const draft = get().draft.trimEnd();
    return [draft, text].filter(Boolean).join("\n");
  };

  /** Unconsumed queue returns to the composer — an ending run must not eat typed text. */
  const recallQueue = () => {
    const q = get().queued;
    if (q.length === 0) return;
    set({ queued: [], draft: mergeIntoDraft(q.map((x) => x.text).join("\n")) });
  };

  /** A stop's pending redirect that errored instead of unwinding cleanly returns to the composer. */
  const returnPending = () => {
    const pending = get().pendingSend;
    if (pending === null) return;
    set({ pendingSend: null, draft: mergeIntoDraft(pending) });
  };

  const startRun = (p: chrome.runtime.Port, task: string, images?: string[]) => {
    sawAssistantText = false;
    set({
      status: "running",
      streamingText: "",
      reasoningText: "",
      reasoningStartedAt: null,
      usage: { input: 0, output: 0 },
      runStartedAt: Date.now(),
      runEndedAt: null,
      lastRun: { task, ...(images?.length ? { images } : {}) },
      pendingStepId: null,
      // A new run draws its own card — never revives the last run's checklist.
      planMsgId: null,
    });
    p.postMessage({ type: "run", task, ...(images?.length ? { images } : {}) } satisfies Command);
  };

  /**
   * Send a task, stamping it with the panel's active tab. Guarded against the
   * stop redirect: while pendingSend is set, a user's Enter must not start a
   * third run mid-handoff — the pending send fires from the done handler.
   */
  const sendTask = async (task: string, images?: string[]) => {
    if (get().status === "running" || get().pendingSend !== null) return;
    // The port dies with the worker — reconnect lazily instead of eating the task.
    let p: chrome.runtime.Port;
    try {
      p = attach();
    } catch {
      pushMsg(makeMsg("error", i18n.t("chat.reloaded")));
      return;
    }
    // The message is anchored to the tab it was sent from. The panel queries
    // its own window here — the send-time fact — while the background's own
    // query stays the authority on what the run drives.
    let tab: Message["tab"];
    try {
      const [active] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (active?.url) {
        tab = {
          title: active.title ?? "",
          url: active.url,
          ...(active.favIconUrl ? { favIconUrl: active.favIconUrl } : {}),
        };
      }
    } catch {
      // No stamp — the run still gets its tab from the background.
    }
    // Stored BEFORE the run starts: the worker builds this run's history by
    // reading the transcript, so a fire-and-forget write would race it and
    // cost the model the exchange it is being asked to continue.
    await pushMsg(
      makeMsg("user", task, { ...(images?.length ? { images } : {}), ...(tab ? { tab } : {}) }),
    );
    startRun(p, task, images);
  };

  const handleEvent = (event: Event) => {
    const s = get();
    switch (event.type) {
      case "driving":
        // The event payload IS the chip's data — see DrivingPayload in protocol.
        set({ drivingTab: event });
        break;

      case "token":
        flushReasoning();
        set({ streamingText: get().streamingText + event.text });
        break;

      case "reasoning":
        flushStreaming();
        set({
          reasoningText: get().reasoningText + event.text,
          // The first delta of a segment starts its clock.
          reasoningStartedAt: get().reasoningStartedAt ?? Date.now(),
        });
        break;

      case "step_start": {
        flushReasoning();
        const key = toolVerbKey(event.tool);
        const msg = makeMsg("step", key ? `${i18n.t(key)}…` : "…", {
          tool: event.tool,
          args: event.args,
          live: true,
        });
        // Live rows are in-memory only — persisted once the tool finishes.
        set({ messages: [...get().messages, msg], pendingStepId: msg.id });
        break;
      }

      case "step": {
        flushReasoning();
        const settled: Partial<Message> = {
          content: event.summary,
          ok: event.ok,
          args: event.args,
          detail: event.detail,
          images: event.images,
          live: false,
        };
        const pending = get().pendingStepId;
        if (pending) {
          // Settle the live row in place, then persist the finished step.
          const msgs = get().messages.map((m) => (m.id === pending ? { ...m, ...settled } : m));
          set({ messages: msgs, pendingStepId: null });
          const finished = msgs.find((m) => m.id === pending);
          if (finished) void appendMessage(finished);
        } else {
          pushMsg(makeMsg("step", event.summary, { tool: event.tool, ...settled }));
        }
        break;
      }

      case "plan": {
        flushReasoning();
        flushStreaming();
        const plan = { steps: event.steps, current: event.current };
        const existing = get().planMsgId;
        if (existing) {
          // Rewritten in place, so the card stays where the agent first drew it
          // instead of a new copy sliding in on every completed step.
          const msgs = get().messages.map((m) => (m.id === existing ? { ...m, ...plan } : m));
          set({ messages: msgs });
          const updated = msgs.find((m) => m.id === existing);
          if (updated) void replaceMessage(updated);
        } else {
          const msg = makeMsg("plan", "", plan);
          set({ planMsgId: msg.id });
          pushMsg(msg);
        }
        break;
      }

      case "injected":
        // The loop consumed a queued message at a tool boundary — the pending
        // line becomes a real transcript entry in the order the model saw it.
        set({ queued: get().queued.filter((q) => q.id !== event.id) });
        pushMsg(makeMsg("user", event.text));
        break;

      case "usage":
        set({
          usage: { input: s.usage.input + event.input, output: s.usage.output + event.output },
        });
        break;

      case "error": {
        // Flush any partial stream first — it must not dangle as a ghost bubble.
        flushReasoning();
        flushStreaming();
        recallQueue();
        // A stop redirect must never auto-fire into an error — hand it back.
        returnPending();
        pushMsg(makeMsg("error", event.message));
        settleRun("error");
        break;
      }

      case "done": {
        flushReasoning();
        flushStreaming();
        // After the flush above, the newest assistant message — if any — is the
        // prose this very run streamed, so it is the only dedup target.
        const lastProse = [...get().messages]
          .reverse()
          .find((m) => m.role === "assistant")?.content;
        const closing = closingSummary(sawAssistantText, lastProse, event.summary);
        if (closing) pushMsg(makeMsg("assistant", closing));
        recallQueue();
        settleRun("idle");
        // The stop was a redirect, not just a halt: the queued text runs as the
        // next task now that the old run has fully unwound.
        const pending = get().pendingSend;
        if (pending !== null) {
          // Clear BEFORE sendTask — the guard above would otherwise bail.
          set({ pendingSend: null });
          void sendTask(pending);
        }
        break;
      }
    }
  };

  /** Send if the port lives, swallow if it died — onDisconnect does the cleanup. */
  const post = (cmd: Command) => {
    try {
      port?.postMessage(cmd);
    } catch {
      // Port already gone.
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
      recallQueue();
      // A stop redirect must survive a mid-handoff port drop — back to the composer.
      returnPending();
      settleRun("idle");
    });
    pingTimer ??= setInterval(() => post({ type: "ping" }), 25_000);
    return p;
  };

  return {
    messages: [],
    conversations: [],
    activeId: null,
    status: "idle",
    streamingText: "",
    reasoningText: "",
    reasoningStartedAt: null,
    usage: { input: 0, output: 0 },
    runStartedAt: null,
    runEndedAt: null,
    lastRun: null,
    pendingStepId: null,
    planMsgId: null,
    queued: [],
    pendingSend: null,
    draft: "",
    drivingTab: null,

    connect: () => {
      if (port) return;
      void listConversations().then((conversations) => set({ conversations }));
      unwatchConversations ??= watchConversations((conversations) => set({ conversations }));
      void getActiveId().then(async (activeId) => {
        set({ activeId, messages: activeId ? await getMessages(activeId) : [] });
      });
      attach();
    },

    disconnect: () => {
      unwatchConversations?.();
      unwatchConversations = null;
      if (!port) return;
      intentionalDisconnect = true;
      port.disconnect();
      port = null;
      if (pingTimer) {
        clearInterval(pingTimer);
        pingTimer = null;
      }
    },

    sendTask,

    queueMessage: (text) => {
      const item = { id: crypto.randomUUID(), text };
      set({ queued: [...get().queued, item] });
      // Port gone mid-run: onDisconnect recalls the queue to the composer.
      post({ type: "inject", ...item });
    },

    unqueueMessage: (id) => {
      set({ queued: get().queued.filter((q) => q.id !== id) });
      post({ type: "unqueue", id });
    },

    recallQueued: () => {
      const queued = get().queued;
      const last = queued[queued.length - 1];
      if (!last) return;
      set({ queued: queued.slice(0, -1), draft: last.text });
      post({ type: "unqueue", id: last.id });
    },

    setDraft: (text) => set({ draft: text }),

    retry: () => {
      const last = get().lastRun;
      if (!last || get().status === "running") return;
      // No duplicate user row — the failed attempt sits right above.
      let p: chrome.runtime.Port;
      try {
        p = attach();
      } catch {
        pushMsg(makeMsg("error", i18n.t("chat.reloaded")));
        return;
      }
      startRun(p, last.task, last.images);
    },

    stop: () => {
      // A queued message turns the halt into a redirect: the queue is sent as the
      // next task once the current run has fully unwound (its done event). A second
      // stop during the unwind must preserve the pending text, not wipe it.
      const pending =
        get().queued.length > 0
          ? get().queued.map((x) => x.text).join("\n")
          : get().pendingSend;
      post({ type: "stop" });
      // Deliberately NOT settleRun: the loop's done event arrives as the worker
      // unwinds and flushes any partial stream into the transcript first.
      set((st) => ({
        messages: settleLive(st.messages),
        status: "idle",
        runEndedAt: Date.now(),
        pendingStepId: null,
        queued: [],
        pendingSend: pending,
      }));
    },

    newConversation: () => {
      void setActiveConversation(null);
      set({ ...resetRun(), messages: [], activeId: null });
    },

    openConversation: (id) => {
      if (get().activeId === id) return;
      void setActiveConversation(id);
      set({ ...resetRun(), messages: [], activeId: id });
      void getMessages(id).then((messages) => {
        // A switch that raced this read wins — never paint a stale transcript.
        if (get().activeId === id) set({ messages });
      });
    },

    removeConversation: (id) => {
      void deleteConversation(id);
      set((st) => ({
        conversations: st.conversations.filter((c) => c.id !== id),
        // Deleting the open one drops you into a fresh transcript, not a void.
        ...(st.activeId === id ? { ...resetRun(), messages: [], activeId: null } : {}),
      }));
    },
  };
});
