/**
 * Bridge wire protocol — the daemon's copy.
 *
 * Deliberately duplicated from `src/modules/bridge/protocol.ts`: the daemon is
 * a standalone bun program with its own package.json, and importing across that
 * line would drag the extension's `@/` aliases and DOM types into a server. The
 * two copies must change together — the extension's file is the source of truth.
 */

// ── Extension → daemon ──────────────────────────────────────────────

export interface BridgeHello {
  type: "hello";
  extensionId: string;
  version: string;
}

export interface BridgePong {
  type: "pong";
}

export interface BridgeResponse {
  type: "response";
  requestId: string;
  ok: boolean;
  result?: unknown;
  error?: { code: string; message: string };
}

export interface BridgeRunEvent {
  type: "event";
  event: CompactRunEvent;
}

export type ExtensionMessage = BridgeHello | BridgePong | BridgeResponse | BridgeRunEvent;

// ── Daemon → extension ──────────────────────────────────────────────

export interface BridgePing {
  type: "ping";
}

export interface BridgeRequest {
  type: "request";
  requestId: string;
  method: string;
  params: Record<string, unknown>;
}

export type DaemonMessage = BridgePing | BridgeRequest;

// ── Run events and status ───────────────────────────────────────────

export type CompactRunEvent =
  | { type: "step_start"; tool: string }
  | { type: "step"; tool: string; summary: string; ok?: boolean }
  | { type: "plan"; steps: string[]; current: number }
  | { type: "driving"; tabId: number; windowId: number; title: string }
  | { type: "error"; message: string }
  | { type: "done"; summary?: string }
  | { type: "question"; question: string };

export interface BridgeStatus {
  conversationId: string | null;
  runId: string | null;
  state: "idle" | "running" | "question" | "done" | "error";
  startedAt: number | null;
  finishedAt: number | null;
  steps: { tool: string; summary: string; ok?: boolean }[];
  plan: { steps: string[]; current: number } | null;
  driving: { tabId: number; windowId: number; title: string } | null;
  question: string | null;
  error: string | null;
  summary: string | null;
}

export function emptyStatus(): BridgeStatus {
  return {
    conversationId: null,
    runId: null,
    state: "idle",
    startedAt: null,
    finishedAt: null,
    steps: [],
    plan: null,
    driving: null,
    question: null,
    error: null,
    summary: null,
  };
}

/** The screenshot payload the extension answers `screenshot` with. */
export interface CaptureResult {
  dataUrl: string;
  tabId: number;
  title: string;
  url: string;
  /** false when the captured tab isn't the one the agent is driving. */
  driven: boolean;
}

/**
 * Fold one pushed event into the local status mirror. The extension runs the
 * same reduction over its richer event stream (`src/modules/bridge/status.ts`);
 * this side only ever sees the compact form, so a dropped connection costs
 * nothing a `sync` can't rebuild.
 *
 * Returns true when the change is one a waiting `get_status` should wake for —
 * `step_start` alone is noise, everything else is progress worth a turn.
 */
export function applyCompact(status: BridgeStatus, event: CompactRunEvent): boolean {
  switch (event.type) {
    case "step_start":
      return false;
    case "step":
      status.steps.push({ tool: event.tool, summary: event.summary, ok: event.ok });
      return true;
    case "plan":
      status.plan = { steps: event.steps, current: event.current };
      return true;
    case "driving":
      status.driving = { tabId: event.tabId, windowId: event.windowId, title: event.title };
      return true;
    case "question":
      status.state = "question";
      status.question = event.question;
      status.finishedAt = Date.now();
      return true;
    case "error":
      status.state = "error";
      status.error = event.message;
      status.finishedAt = Date.now();
      return true;
    case "done":
      // ask_user ends the run too, and its `done` arrives right behind the
      // question — it must not overwrite the question as the closing state.
      if (status.state !== "question") {
        status.state = "done";
        status.summary = event.summary ?? null;
      }
      status.finishedAt = Date.now();
      return true;
  }
}
