/**
 * Port protocol — discriminated unions for the chrome.runtime.connect channel.
 * Commands flow side-panel → background; events flow background → side-panel.
 */

import type { TabId } from "./types";

// ── Commands (side panel → background) ──────────────────────────────

export type Command =
  /** images are data URLs the user attached; the task text references them as "[Image #1]" */
  | { type: "run"; task: string; images?: string[] }
  | { type: "stop" }
  /**
   * Message typed while a run is in flight — the loop inserts it between tool
   * batches, so the model sees it in order without interrupting the run.
   */
  | { type: "inject"; id: string; text: string }
  /** The user edited or dropped a queued message before it was consumed. */
  | { type: "unqueue"; id: string }
  /** Heartbeat — receiving it resets the worker's idle timer during long silences */
  | { type: "ping" };

// ── Events (background → side panel) ────────────────────────────────

export type Event =
  /**
   * Which tab this run is driving — the panel is window-scoped and stays open
   * on every tab, so the run names its target instead of leaving it a mystery.
   */
  | { type: "driving"; tabId: TabId; windowId: number; title: string; favIconUrl?: string }
  | { type: "token"; text: string }
  | { type: "reasoning"; text: string }
  /** A tool call is about to execute — the panel shows it as a live (spinning) row */
  | { type: "step_start"; tool: string; args?: Record<string, unknown> }
  /** ok: true = tool succeeded, false = tool failed, absent = neutral note (retry, warn) */
  | {
      type: "step";
      tool: string;
      summary: string;
      ok?: boolean;
      /** Model-supplied arguments — the row's hint line and drill-down */
      args?: Record<string, unknown>;
      /** Result payload, truncated at the source. Behind a disclosure, never inline. */
      detail?: string;
      /** Screenshot data URLs — shown in the drill-down, dropped before storage */
      images?: string[];
    }
  /** The agent's checklist — replaces the previous one rather than appending */
  | { type: "plan"; steps: string[]; current: number }
  /** A queued message was inserted into the conversation at a tool boundary */
  | { type: "injected"; id: string; text: string }
  | { type: "usage"; input: number; output: number }
  | { type: "error"; message: string }
  /** summary is the done tool's final answer — present when the model ends on a tool-only turn */
  | { type: "done"; summary?: string };

// ── Port name ────────────────────────────────────────────────────────

export const PORT_NAME = "regent";
