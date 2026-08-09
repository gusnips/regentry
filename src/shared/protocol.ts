/**
 * Port protocol — discriminated unions for the chrome.runtime.connect channel.
 * Commands flow side-panel → background; events flow background → side-panel.
 */

import type { TabId } from "./types";

// ── Commands (side panel → background) ──────────────────────────────

export type Command =
  /** images are data URLs the user attached; the task text references them as "[Image #1]";
   *  thisPage opts out of the default background tab and drives the user's current one */
  | { type: "run"; task: string; images?: string[]; thisPage?: boolean }
  | { type: "stop" }
  /**
   * Message typed while a run is in flight — the loop inserts it between tool
   * batches, so the model sees it in order without interrupting the run.
   */
  | { type: "inject"; id: string; text: string }
  /** The user edited or dropped a queued message before it was consumed. */
  | { type: "unqueue"; id: string }
  /** Cancel a run still waiting in the serial run queue (not the active one). */
  | { type: "cancel_queued"; id: string }
  /**
   * The user answered a plan-approval prompt — the loop resumes or ends on it.
   * `feedback` turns a "no" into a revision request: the run stays alive, the
   * model replans with the changes, and the revised plan is asked about again.
   */
  | { type: "plan_approval"; approved: boolean; feedback?: string }
  /** Ask what an external agent is doing in the browser — answered with run_active. */
  | { type: "query_run" }
  /** Heartbeat — receiving it resets the worker's idle timer during long silences */
  | { type: "ping" };

// ── Events (background → side panel) ────────────────────────────────

/**
 * Payload shapes named once here — the agent loop and the panel store import
 * them instead of maintaining their own field-for-field copies.
 */

/** One finished tool call, as the panel renders it. */
export interface StepPayload {
  tool: string;
  summary: string;
  /** true = tool succeeded, false = tool failed, absent = neutral note (retry, warn) */
  ok?: boolean;
  /** Model-supplied arguments — the row's hint line and drill-down */
  args?: Record<string, unknown>;
  /** Result payload, truncated at the source. Behind a disclosure, never inline. */
  detail?: string;
  /** Screenshot data URLs — shown in the drill-down, dropped before storage */
  images?: string[];
}

/**
 * Which tab this run is driving — the panel is window-scoped and stays open
 * on every tab, so the run names its target instead of leaving it a mystery.
 */
export interface DrivingPayload {
  tabId: TabId;
  windowId: number;
  title: string;
  favIconUrl?: string;
}

/** The agent's checklist — replaces the previous one rather than appending. */
export interface PlanPayload {
  steps: string[];
  /** 0-based; equals steps.length once every step is finished. */
  current: number;
}

/**
 * An external client working in the browser — the bridge's delegated run, or a
 * direct-driving session. The panel shows this as a status band, because the
 * run it represents is already blinking the driven tab's favicon.
 */
export interface BridgeActive {
  /** run = a delegated task; direct = the client clicking through itself. */
  mode: "run" | "direct";
  /** The MCP client's name — the same label history shows on the thread. */
  client: string;
}

export type Event =
  | ({ type: "driving" } & DrivingPayload)
  | { type: "token"; text: string }
  | { type: "reasoning"; text: string }
  /** A tool call is about to execute — the panel shows it as a live (spinning) row */
  | { type: "step_start"; tool: string; args?: Record<string, unknown> }
  | ({ type: "step" } & StepPayload)
  | ({ type: "plan" } & PlanPayload)
  /**
   * The agent proposed a plan and is parked until the user answers. `reapproval`
   * marks a mid-run change big enough to need a fresh yes, not the first ask.
   */
  | { type: "plan_approval"; steps: string[]; reapproval: boolean }
  /** A queued message was inserted into the conversation at a tool boundary */
  | { type: "injected"; id: string; text: string }
  /** The submitted run is waiting in the serial queue — position is 1-based. */
  | { type: "run_queued"; id: string; position: number }
  | { type: "usage"; input: number; output: number }
  | { type: "error"; message: string; /** user-initiated ending (driven tab closed) — no notification */ silent?: boolean }
  /** summary is the done tool's final answer — present when the model ends on a tool-only turn;
   *  question marks a run that ended on ask_user — its own notification already fired */
  | { type: "done"; summary?: string; question?: boolean }
  /** Who an external agent is in the browser — null when the browser is yours again */
  | { type: "run_active"; active: BridgeActive | null };

// ── Port name ────────────────────────────────────────────────────────

export const PORT_NAME = "tabrunner";
