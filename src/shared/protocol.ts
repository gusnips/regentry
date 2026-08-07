/**
 * Port protocol — discriminated unions for the chrome.runtime.connect channel.
 * Commands flow side-panel → background; events flow background → side-panel.
 */

// ── Commands (side panel → background) ──────────────────────────────

export type Command =
  | { type: "run"; task: string }
  | { type: "stop" }
  | { type: "pause" };

// ── Events (background → side panel) ────────────────────────────────

export type Event =
  | { type: "token"; text: string }
  | { type: "step"; tool: string; summary: string }
  | { type: "tool_call"; tool: string; args: Record<string, unknown> }
  | { type: "tool_result"; tool: string; ok: boolean; detail?: string }
  | { type: "error"; message: string }
  | { type: "done" };

// ── Port name ────────────────────────────────────────────────────────

export const PORT_NAME = "regent";
