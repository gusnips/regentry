import { create } from "zustand";
import { i18n } from "@/i18n";
import type { BridgeActive, Command, DrivingPayload, Event } from "@/shared/protocol";
import { PORT_NAME } from "@/shared/protocol";
import type { Message, AgentStatus } from "../types";
import type { ConversationMeta } from "../conversations";
import { runBoardItem } from "@/modules/agent/run-queue";
import type { RunBoard } from "@/modules/agent/run-queue";
import {
  appendMessage,
  deleteConversation,
  getActiveId,
  getMessages,
  listConversations,
  setActiveConversation,
  watchConversations,
} from "../conversations";
import { closingSummary } from "../transcript";
import { toolVerbKey } from "./tool-labels";
import type { PastedText } from "./paste-collapse";

/** Where a submitted task drives — the user's current page ("thisPage", the
 *  default, with the panel open) or the same tab with the panel closed after
 *  plan approval ("background"). Both drive the tab you're on; the only
 *  difference is whether you watch or walk away. */
export type RunTarget = "background" | "thisPage";

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
  lastRun: { task: string; images?: string[]; thisPage?: boolean } | null;
  /** Where the next submitted task drives — background tab or this page. */
  runTarget: RunTarget;
  /** Id of the in-flight tool's live row (never persisted) */
  pendingStepId: string | null;
  /** Id of this run's plan card — updates rewrite it rather than stacking copies */
  planMsgId: string | null;
  /** A proposed plan parked on the user's answer — the run resumes on approve, ends on reject. */
  planApproval: { steps: string[]; reapproval: boolean } | null;
  /** Messages typed mid-run, waiting for the next tool boundary. */
  queued: { id: string; text: string }[];
  /** Joined queued text waiting to auto-run once the current run fully unwinds (a stop redirect). */
  pendingSend: string | null;
  /** The composer's text, so a recalled queue or an ending run can hand text back to it. */
  draft: string;
  /** Collapsed pastes — token in the input, content spliced back in on send. */
  pastedTexts: PastedText[];
  /** A removed collapse teaches this draft to paste inline — the fold is only a surprise once. */
  collapseDisabled: boolean;
  /** The tab the current run is driving; null when idle. */
  drivingTab: DrivingPayload | null;
  /** An external client working in the browser (a bridge run or direct session) */
  bridgeActive: BridgeActive | null;
  /** The ambient run state — what runs/queues anywhere, widget-fed. */
  board: RunBoard;
  /** This panel's own submission waiting in the serial queue. */
  queuedRun: { id: string; position: number; task: string } | null;

  connect: () => void;
  disconnect: () => void;
  sendTask: (task: string, images?: string[]) => void;
  /** A local, display-only note (slash-command results) — rendered in the
   *  transcript, never persisted, never part of the model's history. */
  note: (content: string) => void;
  queueMessage: (text: string) => void;
  unqueueMessage: (id: string) => void;
  /** Cancel this panel's still-waiting queued run. */
  cancelQueuedRun: () => void;
  /** Cancel any panel-owned waiting run — the run board's per-row cancel. */
  cancelQueuedById: (id: string) => void;
  /** ↑-arrow recall: the newest queued message goes back to the composer. */
  recallQueued: () => void;
  setDraft: (text: string) => void;
  setRunTarget: (target: RunTarget) => void;
  /** Stash a collapsed paste's content behind its token. */
  addPastedText: (entry: PastedText) => void;
  /** Fresh draft after a send — the fold is fair game again. */
  clearPastedTexts: () => void;
  retry: () => void;
  stop: () => void;
  /** Answer a parked plan prompt — the loop resumes on approve, unwinds on reject. */
  approvePlan: () => void;
  rejectPlan: () => void;
  /** Send a parked plan back with changes — the model replans and asks again. */
  revisePlan: (feedback: string) => void;
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
/** Storage watch on the run board — the widget's state, mirrored here. */
let unwatchBoard: (() => void) | null = null;
/** Did this run stream any prose? Governs done-summary dedup, never its display. */
let sawAssistantText = false;
/** Dispatch-and-forget's close handshake: the panel closes on the first event
 *  back (proof the command landed), with a fallback if none ever comes. */
let closeOnFirstEvent = false;
let closeTimer: ReturnType<typeof setTimeout> | null = null;

function schedulePanelClose(): void {
  closeOnFirstEvent = true;
  if (closeTimer) clearTimeout(closeTimer);
  closeTimer = setTimeout(() => window.close(), 1500);
}

function cancelPanelClose(): void {
  closeOnFirstEvent = false;
  if (closeTimer) {
    clearTimeout(closeTimer);
    closeTimer = null;
  }
}

function makeMsg(role: Message["role"], content: string, extra?: Partial<Message>): Message {
  return { id: crypto.randomUUID(), role, content, timestamp: Date.now(), ...extra };
}

// The dedup helper lives in the background-safe transcript writer — both the
// panel and the bridge close runs the same way.
export { closingSummary };

export const useConversationStore = create<ConversationState>((set, get) => {
  /** Resolves once the message is stored — awaited only where ordering matters. */
  const pushMsg = (msg: Message): Promise<void> => {
    set({ messages: [...get().messages, msg] });
    // A fresh conversation is created by the first append — adopt its id.
    return appendMessage(msg).then((id) => {
      if (get().activeId !== id) set({ activeId: id });
    });
  };

  /** Display-only append — run events persist through the shared writer. */
  const pushDisplay = (msg: Message): void => {
    set({ messages: [...get().messages, msg] });
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
    planApproval: null,
    queued: [],
    pendingSend: null,
    draft: "",
    pastedTexts: [],
    collapseDisabled: false,
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
      pushDisplay(
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
      pushDisplay(makeMsg("assistant", text));
    }
    set({ streamingText: "" });
  };

  /** A run that ends with a tool in flight must not leave its row spinning. */
  const settleLive = (msgs: Message[]) => msgs.map((m) => (m.live ? { ...m, live: false } : m));

  /**
   * The one run-end transition — error, done, and a lost port all land here.
   * runStartedAt survives so the summary line can still say how long it went.
   */
  const settleRun = (status: AgentStatus) => {
    set((st) => ({
      messages: settleLive(st.messages),
      streamingText: "",
      reasoningText: "",
      reasoningStartedAt: null,
      status,
      runEndedAt: Date.now(),
      pendingStepId: null,
      planApproval: null,
      drivingTab: null,
      queuedRun: null,
    }));
  };

  /** Recall a text into the composer, preserving anything already there. */
  const mergeIntoDraft = (text: string) => {
    const draft = get().draft.trimEnd();
    return [draft, text].filter(Boolean).join("\n");
  };

  /** Unconsumed queue returns to the composer — an ending run must not eat typed text. */
  const recallQueue = () => {
    const q = get().queued;
    if (q.length === 0) return;
    set({
      queued: [],
      draft: mergeIntoDraft(q.map((x) => x.text).join("\n")),
      collapseDisabled: false,
    });
  };

  /** A stop's pending redirect that errored instead of unwinding cleanly returns to the composer. */
  const returnPending = () => {
    const pending = get().pendingSend;
    if (pending === null) return;
    set({ pendingSend: null, draft: mergeIntoDraft(pending), collapseDisabled: false });
  };

  const startRun = (
    p: chrome.runtime.Port,
    task: string,
    images?: string[],
    thisPage?: boolean,
  ) => {
    sawAssistantText = false;
    // Persistence is the worker's job now (it owns the transcript writer — the
    // panel may close right after submit); this store only renders.
    set({
      status: "running",
      streamingText: "",
      reasoningText: "",
      reasoningStartedAt: null,
      usage: { input: 0, output: 0 },
      runStartedAt: Date.now(),
      runEndedAt: null,
      lastRun: { task, ...(images?.length ? { images } : {}), ...(thisPage ? { thisPage } : {}) },
      pendingStepId: null,
      // A new run draws its own card — never revives the last run's checklist.
      planMsgId: null,
      planApproval: null,
    });
    p.postMessage({
      type: "run",
      task,
      ...(images?.length ? { images } : {}),
      ...(thisPage ? { thisPage } : {}),
    } satisfies Command);
  };

  /**
   * Send a task. In "this page" mode it is stamped with the panel's active tab;
   * an adopted background run drives that same tab, so the stamp carries the
   * tab the run is about either way. Guarded against the stop redirect: while
   * pendingSend is set, a user's Enter must not start a third run mid-handoff —
   * the pending send fires from the done handler.
   */
  const sendTask = async (task: string, images?: string[]) => {
    if (get().pendingSend !== null) return;
    // A run in flight steers instead (ChatInput routes there) — but when our
    // own submission is only waiting in the queue, a new one joins the line.
    if (get().status === "running" && !get().queuedRun) return;
    // The port dies with the worker — reconnect lazily instead of eating the task.
    let p: chrome.runtime.Port;
    try {
      p = attach();
    } catch {
      pushMsg(makeMsg("error", i18n.t("chat.reloaded")));
      return;
    }
    const thisPage = get().runTarget === "thisPage";
    // The message is anchored to the tab it was sent from. The panel queries
    // its own window here — the send-time fact — while the background's own
    // query stays the authority on what the run drives.
    let tab: Message["tab"];
    if (thisPage) {
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
    }
    // Stored BEFORE the run starts: the worker builds this run's history by
    // reading the transcript, so a fire-and-forget write would race it and
    // cost the model the exchange it is being asked to continue.
    await pushMsg(
      makeMsg("user", task, { ...(images?.length ? { images } : {}), ...(tab ? { tab } : {}) }),
    );
    startRun(p, task, images, thisPage || undefined);
    // The panel stays up through the plan: a background run's FIRST act is to
    // read the page and ask you to approve what it intends to do, and closing
    // before that turns the approval into an OS notification you have to click
    // your way back from. Dispatch-and-forget starts at approvePlan, where the
    // work actually becomes unattended.
  };

  const handleEvent = (event: Event) => {
    const s = get();
    if (closeOnFirstEvent) {
      // Never close on something the user still has to see: an immediate
      // failure, or a replan that re-opens the gate before the panel is gone.
      if (event.type === "error" || event.type === "plan_approval") cancelPanelClose();
      else if (
        event.type === "run_queued" ||
        event.type === "driving" ||
        event.type === "step_start"
      ) {
        cancelPanelClose();
        window.close();
        return;
      }
    }
    switch (event.type) {
      case "driving":
        // The event payload IS the chip's data — see DrivingPayload in protocol.
        // A queued run's first driving event means the wait is over.
        set({ drivingTab: event, queuedRun: null });
        break;

      case "run_queued":
        // The submission is waiting in the serial queue — ChatInput says where.
        set({
          queuedRun: { id: event.id, position: event.position, task: get().lastRun?.task ?? "" },
        });
        break;

      case "run_active":
        set({ bridgeActive: event.active });
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
          // Settle the live row in place — persistence is the writer's job now.
          set({
            messages: get().messages.map((m) => (m.id === pending ? { ...m, ...settled } : m)),
            pendingStepId: null,
          });
        } else {
          pushDisplay(makeMsg("step", event.summary, { tool: event.tool, ...settled }));
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
          set({
            messages: get().messages.map((m) => (m.id === existing ? { ...m, ...plan } : m)),
          });
        } else {
          const msg = makeMsg("plan", "", plan);
          set({ planMsgId: msg.id });
          pushDisplay(msg);
        }
        break;
      }

      case "injected":
        // The loop consumed a queued message at a tool boundary — the pending
        // line becomes a real transcript entry in the order the model saw it.
        set({ queued: get().queued.filter((q) => q.id !== event.id) });
        pushDisplay(makeMsg("user", event.text));
        break;

      case "plan_approval":
        // The loop is parked until the user answers — the plan card above
        // already shows what is being asked; this arms the approval card.
        set({ planApproval: { steps: event.steps, reapproval: event.reapproval } });
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
        pushDisplay(makeMsg("error", event.message, { kind: event.kind }));
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
        if (closing) pushDisplay(makeMsg("assistant", closing));
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
      // The worker died with its state — nothing can be in the browser now; the
      // next connect re-asks and gets the fresh answer.
      set({ bridgeActive: null });
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
    // Ask on connect: the broadcast may have happened while the panel was
    // closed, and a stale state must never read as "the browser is idle".
    post({ type: "query_run" });
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
    runTarget: "thisPage",
    pendingStepId: null,
    planMsgId: null,
    planApproval: null,
    queued: [],
    pendingSend: null,
    draft: "",
    pastedTexts: [],
    collapseDisabled: false,
    drivingTab: null,
    bridgeActive: null,
    board: { queue: [] },
    queuedRun: null,

    connect: () => {
      if (port) return;
      void listConversations().then((conversations) => set({ conversations }));
      unwatchConversations ??= watchConversations((conversations) => set({ conversations }));
      void runBoardItem.get().then((board) => set({ board }));
      unwatchBoard ??= runBoardItem.watch((board) => {
        const prev = get().board;
        set({ board });
        // A worker restart resets the board to empty — drop the queued chip
        // the dead queue can never fulfill.
        if (!board.running && board.queue.length === 0 && get().queuedRun) {
          set({ queuedRun: null });
        }
        // The frozen reopened panel: this conversation's run moved (started,
        // retargeted, finished) — pull the transcript the worker has been
        // writing so completion lands in the open panel.
        const activeId = get().activeId;
        if (!activeId) return;
        const wasHere = prev.running?.conversationId === activeId;
        const isHere = board.running?.conversationId === activeId;
        if (!isHere && !wasHere) return;
        void getMessages(activeId).then((messages) => {
          if (get().activeId === activeId) set({ messages });
        });
      });
      void getActiveId().then(async (activeId) => {
        set({ activeId, messages: activeId ? await getMessages(activeId) : [] });
      });
      attach();
    },

    disconnect: () => {
      unwatchConversations?.();
      unwatchConversations = null;
      unwatchBoard?.();
      unwatchBoard = null;
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

    // A tool-less step row is the note: quiet, neutral, and gone on reopen.
    note: (content) => pushDisplay(makeMsg("step", content)),

    cancelQueuedRun: () => {
      const queued = get().queuedRun;
      if (!queued) return;
      post({ type: "cancel_queued", id: queued.id });
      // Optimistic settle — if the run raced ahead and started, its events
      // land next and the store recovers through them.
      settleRun("idle");
    },

    // The run board's per-row cancel — the worker validates it is a panel entry.
    cancelQueuedById: (id) => post({ type: "cancel_queued", id }),

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
      set({ queued: queued.slice(0, -1), draft: last.text, collapseDisabled: false });
      post({ type: "unqueue", id: last.id });
    },

    // The single user-edit writer (ChatInput routes every edit here): a collapse
    // whose token left the text drops its content — and, per draft, teaches the
    // input to paste inline: the fold is only ever a surprise once. Store-side
    // draft writers re-arm it — a recalled text is a fresh draft.
    setDraft: (text) =>
      set((st) => {
        const kept = st.pastedTexts.filter((p) => text.includes(p.token));
        const dropped = kept.length < st.pastedTexts.length;
        return { draft: text, pastedTexts: kept, collapseDisabled: dropped || st.collapseDisabled };
      }),
    addPastedText: (entry) => set((st) => ({ pastedTexts: [...st.pastedTexts, entry] })),
    clearPastedTexts: () => set({ pastedTexts: [], collapseDisabled: false }),
    setRunTarget: (target) => set({ runTarget: target }),

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
      // Same as sendTask: the retry goes back through the plan gate, and the
      // panel leaves with the approval.
      startRun(p, last.task, last.images, last.thisPage);
    },

    stop: () => {
      // A queued message turns the halt into a redirect: the queue is sent as the
      // next task once the current run has fully unwound (its done event). A second
      // stop during the unwind must preserve the pending text, not wipe it.
      const pending =
        get().queued.length > 0
          ? get()
              .queued.map((x) => x.text)
              .join("\n")
          : get().pendingSend;
      post({ type: "stop" });
      // Deliberately NOT settleRun: the loop's done event arrives as the worker
      // unwinds and flushes any partial stream into the transcript first.
      set((st) => ({
        messages: settleLive(st.messages),
        status: "idle",
        runEndedAt: Date.now(),
        pendingStepId: null,
        planApproval: null,
        queued: [],
        pendingSend: pending,
      }));
    },

    approvePlan: () => {
      if (!get().planApproval) return;
      post({ type: "plan_approval", approved: true });
      set({ planApproval: null });
      // Approval is the handover: from here the run is unattended, so a
      // background one this panel dispatched takes the panel with it and gets
      // out of the way. The close waits for the next event — proof the approval
      // landed. A reject ends the run and a revision parks it again, so neither
      // closes; and a panel the user opened by hand to answer a parked run
      // (lastRun is another session's) stays, because closing a window someone
      // just opened reads as a crash, not as tact.
      const dispatched = get().lastRun;
      if (dispatched && !dispatched.thisPage) schedulePanelClose();
    },

    rejectPlan: () => {
      if (!get().planApproval) return;
      post({ type: "plan_approval", approved: false });
      set({ planApproval: null });
    },

    revisePlan: (feedback) => {
      if (!get().planApproval) return;
      const note = feedback.trim();
      if (!note) return;
      post({ type: "plan_approval", approved: false, feedback: note });
      set({ planApproval: null });
      // The note is a user message like any other: the transcript shows what
      // the plan was sent back with, and the next run reads it as history.
      void pushMsg(makeMsg("user", note));
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
