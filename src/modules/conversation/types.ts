export type MessageRole = "user" | "assistant" | "step" | "error";

export interface Message {
  id: string;
  role: MessageRole;
  content: string;
  /** For step messages: which tool ran */
  tool?: string;
  timestamp: number;
}

export type AgentStatus = "idle" | "running" | "error";
