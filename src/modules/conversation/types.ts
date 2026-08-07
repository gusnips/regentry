export type MessageRole = "user" | "assistant" | "step" | "error";

export interface Message {
  id: string;
  role: MessageRole;
  content: string;
  /** For step messages: which tool ran */
  tool?: string;
  /** For step messages: whether the tool call succeeded (absent = neutral note) */
  ok?: boolean;
  timestamp: number;
}

export type AgentStatus = "idle" | "running" | "error";
