export type MessageRole = "user" | "assistant" | "reasoning" | "step" | "error";

export interface Message {
  id: string;
  role: MessageRole;
  content: string;
  /** For step messages: which tool ran */
  tool?: string;
  /** For step messages: whether the tool call succeeded (absent = neutral note) */
  ok?: boolean;
  /** For step messages: the tool is executing right now (live rows are never persisted) */
  live?: boolean;
  timestamp: number;
}

export type AgentStatus = "idle" | "running" | "error";
