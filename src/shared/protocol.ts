/**
 * Port protocol — discriminated unions for the chrome.runtime.connect channel.
 * Commands flow side-panel → background; events flow background → side-panel.
 */

// ── Commands (side panel → background) ──────────────────────────────

export type Command = { type: "run"; task: string } | { type: "stop" };

// ── Events (background → side panel) ────────────────────────────────

export type Event =
  | { type: "token"; text: string }
  /** ok: true = tool succeeded, false = tool failed, absent = neutral note (retry, warn) */
  | { type: "step"; tool: string; summary: string; ok?: boolean }
  | { type: "usage"; input: number; output: number }
  | { type: "error"; message: string }
  /** summary is the done tool's final answer — present when the model ends on a tool-only turn */
  | { type: "done"; summary?: string };

// ── Port name ────────────────────────────────────────────────────────

export const PORT_NAME = "regent";
