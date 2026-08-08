/**
 * Bridge wire protocol — the WebSocket channel between the extension and the
 * local MCP daemon. The extension is always the WS *client* (an MV3 service
 * worker cannot listen on a socket); the daemon accepts, hosts MCP, and makes
 * requests. The daemon re-declares this shape in its own package — it is a
 * standalone bun script and must not import from the extension bundle.
 */

// ── Extension → daemon ──────────────────────────────────────────────

/** Handshake on (re)connect — the daemon recognizes us and re-syncs its status. */
export interface BridgeHello {
  type: "hello";
  extensionId: string;
  version: string;
}

export interface BridgePong {
  type: "pong";
}

/** Reply to a daemon request, correlated by requestId. */
export interface BridgeResponse {
  type: "response";
  requestId: string;
  ok: boolean;
  result?: unknown;
  error?: { code: string; message: string };
}

/** One run event the daemon turns into status + progress. Compact on purpose:
 *  token deltas and reasoning never cross the wire. */
export interface BridgeRunEvent {
  type: "event";
  event: CompactRunEvent;
}

export type ExtensionMessage = BridgeHello | BridgePong | BridgeResponse | BridgeRunEvent;

// ── Daemon → extension ──────────────────────────────────────────────

export interface BridgePing {
  type: "ping";
}

/** A request from the daemon; method is one of the bridge commands below. */
export interface BridgeRequest {
  type: "request";
  requestId: string;
  method: string;
  params: Record<string, unknown>;
}

export type DaemonMessage = BridgePing | BridgeRequest;

// ── Compact run events (extension → daemon) ─────────────────────────

export type CompactRunEvent =
  | { type: "step_start"; tool: string }
  | { type: "step"; tool: string; summary: string; ok?: boolean }
  | { type: "plan"; steps: string[]; current: number }
  | { type: "driving"; tabId: number; windowId: number; title: string }
  | { type: "error"; message: string }
  | { type: "done"; summary?: string }
  | { type: "question"; question: string };

// ── Run status (serves getStatus + sync rebuild) ────────────────────

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
