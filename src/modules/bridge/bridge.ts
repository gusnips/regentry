import { i18n } from "@/i18n";
import { getActiveRun, releaseRun } from "@/modules/agent/active-runs";
import { startAgentRun } from "@/modules/agent/start-run";
import { captureVisibleTab } from "@/modules/browser";
import { appendMessageTo, openAgentConversation } from "@/modules/conversation";
import { DirectSession } from "./direct";
import { TranscriptWriter } from "@/modules/conversation/transcript";
import { createLogger, truncate } from "@/lib/logger";
import type { Event } from "@/shared/protocol";
import type { BridgeStatus, DaemonMessage, ExtensionMessage } from "./protocol";
import { applyQuestion, applyStatusEvent, emptyStatus, newRunStatus } from "./status";
import { BridgeSocket } from "./ws-client";

const log = createLogger("bridge");

/**
 * The MCP bridge: a WS client to the local daemon that lets external AI clients
 * drive the same agent loop as the panel. Owns the dedicated MCP conversation
 * (never the panel's), the per-run transcript writer, and the compact run
 * status the daemon serves via getStatus. All run mechanics live in
 * startAgentRun — this is only the adapter between WS commands and it.
 */
export class Bridge {
  private socket: BridgeSocket | null = null;
  /** The dedicated MCP thread — created lazily on the first run, reset by newConversation. */
  private conversationId: string | null = null;
  private writer: TranscriptWriter | null = null;
  private status: BridgeStatus = emptyStatus();
  /** Direct browser control, for a client that drives instead of delegating. */
  private readonly direct = new DirectSession();

  /** Synchronous — the socket registers MV3 event listeners in this same turn. */
  start(): void {
    this.socket = new BridgeSocket(
      (msg) => this.onMessage(msg),
      () => this.onOpen(),
    );
    this.socket.start();
  }

  private onOpen(): void {
    this.socket?.send({
      type: "hello",
      extensionId: chrome.runtime.id,
      version: chrome.runtime.getManifest().version,
    });
  }

  private onMessage(msg: DaemonMessage): void {
    switch (msg.type) {
      case "ping":
        this.socket?.send({ type: "pong" });
        break;
      case "request":
        void this.handleRequest(msg.requestId, msg.method, msg.params);
        break;
    }
  }

  private async handleRequest(
    requestId: string,
    method: string,
    params: Record<string, unknown>,
  ): Promise<void> {
    switch (method) {
      case "sync":
        this.respond(requestId, this.status);
        break;
      case "run":
        await this.beginRun(requestId, str(params.task), images(params.images), str(params.agent));
        break;
      case "answer":
        await this.answer(requestId, str(params.text));
        break;
      case "steer":
        this.steer(requestId, str(params.text));
        break;
      case "stop":
        await this.stopRun(requestId);
        break;
      case "screenshot":
        await this.screenshot(requestId);
        break;
      // Direct driving: the daemon exposes a conventional browser_* tool per
      // verb, but they all arrive here as one method — the wire stays small
      // while the MCP surface stays the shape models already know.
      case "browserStart":
        await this.guard(requestId, () =>
          this.direct.start(str(params.goal), str(params.agent) || i18n.t("history.unknownAgent")),
        );
        break;
      case "browserAct":
        await this.guard(requestId, () => this.direct.act(str(params.tool), args(params.args)));
        break;
      case "browserEnd":
        await this.direct.end();
        this.respond(requestId, { ok: true });
        break;
      case "newConversation":
        await this.newConversation(requestId);
        break;
      default:
        this.fail(requestId, "unknown-method", `Unknown bridge method: ${method}`);
    }
  }

  // ── Commands ──────────────────────────────────────────────────────

  private async beginRun(
    requestId: string,
    task: string,
    attached?: string[],
    agent?: string,
  ): Promise<void> {
    if (!task) {
      this.fail(requestId, "empty-task", "Task can't be empty.");
      return;
    }
    if (attached?.some((img) => !img.startsWith("data:image/"))) {
      this.fail(
        requestId,
        "bad-image",
        "Images must be data URLs — data:image/png;base64,<base64>. Pass the bytes base64-encoded.",
      );
      return;
    }
    if (getActiveRun()) {
      this.fail(requestId, "already-running", this.alreadyRunningText());
      return;
    }
    const conversationId = this.ensureThread();
    const runId = crypto.randomUUID();
    log.info("bridge run queued", { runId, task: truncate(task, 120) });
    // Claim the slot optimistically so a getStatus right after run() sees a live run.
    this.status = newRunStatus(conversationId, runId);
    // Stamp the thread with the client that drove it, so history can say which.
    await openAgentConversation(conversationId, agent || i18n.t("history.unknownAgent"));
    // The task must be stored before the run starts — history is rebuilt from
    // the transcript, so a fire-and-forget write loses that race every time.
    await appendMessageTo(conversationId, {
      id: crypto.randomUUID(),
      role: "user",
      content: task,
      timestamp: Date.now(),
      ...(attached?.length ? { images: attached } : {}),
    });
    void this.launch(task, attached);
    this.respond(requestId, { runId, conversationId });
  }

  /** answer() is run with a different word for the model, not a different engine. */
  private async answer(requestId: string, text: string): Promise<void> {
    if (this.status.state !== "question") {
      this.fail(
        requestId,
        "no-question",
        "No question is awaiting an answer. Use run to start a new task.",
      );
      return;
    }
    await this.beginRun(requestId, text);
  }

  private steer(requestId: string, text: string): void {
    if (!text) {
      this.fail(requestId, "empty-text", "Steer message can't be empty.");
      return;
    }
    const run = getActiveRun();
    if (!run || run.owner !== "bridge") {
      this.fail(requestId, "no-run", "No run is in progress to steer. Start one with run.");
      return;
    }
    run.injectedQueue.push({ id: crypto.randomUUID(), text });
    this.respond(requestId, { ok: true });
  }

  private async stopRun(requestId: string): Promise<void> {
    const run = getActiveRun();
    const mine = run?.owner === "bridge";
    // A direct session holds the slot too — stop has to close it, or the slot
    // stays claimed by a session that believes it is still driving.
    if (this.direct.open) await this.direct.end();
    else if (run && mine) {
      run.controller.abort();
      run.injectedQueue.length = 0;
      releaseRun(run);
    }
    // Stop is not an error — a no-op stop still succeeds. But say which no-op
    // it was: a panel run left untouched must never read as "browser is idle".
    this.respond(requestId, { stopped: mine, panelBusy: !mine && run?.owner === "panel" });
  }

  /** What the browser looks like right now — the model's eyes between steps. */
  private async screenshot(requestId: string): Promise<void> {
    try {
      // A direct session drives the tab it opened on; a delegated run reports
      // its own. Either way "driven" must mean "this is the tab being worked".
      const driving = this.direct.drivenTab ?? this.status.driving?.tabId;
      const shot = await captureVisibleTab(this.status.driving?.windowId);
      this.respond(requestId, { ...shot, driven: shot.tabId === driving });
    } catch (e) {
      this.fail(requestId, "capture-failed", e instanceof Error ? e.message : String(e));
    }
  }

  private async newConversation(requestId: string): Promise<void> {
    // Only our own run blocks the reset — a panel run has nothing to do with
    // this thread, and refusing over it would be a dead end with no way out.
    if (!this.direct.open && getActiveRun()?.owner === "bridge") {
      this.fail(
        requestId,
        "run-in-progress",
        "This thread has a run in progress — stop it first, then start the new one.",
      );
      return;
    }
    // A direct session is its own thread; resetting means closing it.
    await this.direct.end();
    this.conversationId = null;
    this.status = emptyStatus();
    this.respond(requestId, { ok: true });
  }

  /**
   * Runs an op that throws its own oriented message (the direct session's do)
   * and answers the daemon either way — an exception here would otherwise
   * leave the client waiting out its request timeout for no reason.
   */
  private async guard(requestId: string, op: () => Promise<unknown>): Promise<void> {
    try {
      this.respond(requestId, await op());
    } catch (e) {
      this.fail(requestId, "direct-failed", e instanceof Error ? e.message : String(e));
    }
  }

  // ── Run plumbing ──────────────────────────────────────────────────

  /** The MCP thread's id — one conversation until newConversation resets it. */
  private ensureThread(): string {
    this.conversationId ??= crypto.randomUUID();
    return this.conversationId;
  }

  private async launch(task: string, images?: string[]): Promise<void> {
    const conversationId = this.ensureThread();
    this.writer = new TranscriptWriter(conversationId);
    const result = await startAgentRun({
      conversationId,
      owner: "bridge",
      task,
      images,
      emit: (event) => this.onRunEvent(event),
      onAskUser: (question) => this.onQuestion(question),
    });
    if (!result.ok) {
      // The preflight above already rejected the common case — this is the rare
      // race losing the slot; surface it as an error the model will see.
      this.onRunEvent({ type: "error", message: this.alreadyRunningText() });
    }
  }

  /** Every run event: persist it, fold it into status, forward the compact form. */
  private onRunEvent(event: Event): void {
    this.writer?.apply(event);
    const compact = applyStatusEvent(this.status, event);
    if (compact) this.socket?.send({ type: "event", event: compact });
    // done/error is the last event of a run — the next one opens its own writer.
    if (event.type === "done" || event.type === "error") this.writer = null;
  }

  /**
   * ask_user is run-terminating: the question becomes the run's closing state
   * and answer() continues the thread. The writer stays open — the loop's own
   * `done` still follows, and its summary belongs in the transcript exactly as
   * it does for a panel run.
   */
  private onQuestion(question: string): void {
    applyQuestion(this.status, question);
    this.socket?.send({ type: "event", event: { type: "question", question } });
  }

  // ── Plumbing ──────────────────────────────────────────────────────

  private respond(requestId: string, result: unknown): void {
    this.socket?.send({ type: "response", requestId, ok: true, result } satisfies ExtensionMessage);
  }

  private fail(requestId: string, code: string, message: string): void {
    this.socket?.send({
      type: "response",
      requestId,
      ok: false,
      error: { code, message },
    } satisfies ExtensionMessage);
  }

  /** Oriented already-running text naming where the run is. */
  private alreadyRunningText(): string {
    const run = getActiveRun();
    return run?.owner === "panel"
      ? i18n.t("errors.alreadyRunningPanel")
      : i18n.t("errors.alreadyRunning");
  }
}

/** Wire params are unknown until proven otherwise — the daemon is not trusted input. */
function str(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

/** Tool arguments arrive as an opaque object — take it only if it is one. */
function args(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function images(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const list = value.filter((v): v is string => typeof v === "string");
  return list.length > 0 ? list : undefined;
}
