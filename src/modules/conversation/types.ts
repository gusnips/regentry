import type { ErrorKind } from "@/modules/providers/error-classify";

export type MessageRole = "user" | "assistant" | "reasoning" | "step" | "error" | "plan";

export interface Message {
  id: string;
  role: MessageRole;
  content: string;
  /**
   * For error messages: the classified provider failure. The message already
   * leads with its own actionable line, so the bubble skips the generic hint.
   */
  kind?: ErrorKind;
  /** For step messages: which tool ran */
  tool?: string;
  /** For step messages: the arguments the model passed — drives the row's hint and drill-down */
  args?: Record<string, unknown>;
  /** For step messages: the tool's result payload, truncated. Expandable, never inline. */
  detail?: string;
  /** For step messages: whether the tool call succeeded (absent = neutral note) */
  ok?: boolean;
  /** For step messages: the tool is executing right now (live rows are never persisted) */
  live?: boolean;
  /**
   * Kept in the transcript for the model, never drawn in the chat — the
   * deterministic progress note an interrupted run leaves behind is written
   * for the next run's replayed history, not for the user (who watched the
   * steps happen and gets the "Stopped" line instead).
   */
  internal?: boolean;
  /**
   * Data-URL images. On a user message these are the attachments they sent and
   * they persist; on a screenshot step they are stripped before storage —
   * see `stripTransient` in conversations.ts for why.
   */
  images?: string[];
  /**
   * For user messages: the tab they were sent from — a message is anchored to
   * the page it meant, and a conversation can span several tabs. Only the
   * message that starts a run is stamped; mid-run injections belong to the
   * run's own tab and carry none.
   */
  tab?: { title: string; url: string; favIconUrl?: string };
  /** For plan messages: the checklist, rewritten in place on every update */
  steps?: string[];
  /** For plan messages: 0-based index of the step in progress */
  current?: number;
  /** For reasoning messages: how long the model thought, in ms */
  elapsed?: number;
  timestamp: number;
}

export type AgentStatus = "idle" | "running" | "error";
