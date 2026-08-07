/** Provider shape — determines wire format for API calls. */
export type ProviderShape = "openai" | "anthropic";

/** A configured provider instance (stored in chrome.storage). */
export interface ProviderConfig {
  id: string;
  name: string;
  shape: ProviderShape;
  baseUrl: string;
  apiKey: string;
  model: string;
  createdAt: number;
}

/** Chat message in provider-agnostic format. */
export interface ChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  toolCallId?: string;
  toolCalls?: ToolCall[];
}

export interface ToolCall {
  id: string;
  name: string;
  args: Record<string, unknown>;
}

/** Tool definition in provider-agnostic format. */
export interface ToolDef {
  name: string;
  description: string;
  params: JSONSchema;
}

export interface JSONSchema {
  type: "object";
  properties: Record<string, { type: string; description: string; enum?: string[] }>;
  required?: string[];
}

/** Streaming delta from the provider. */
export type Delta =
  | { type: "text"; text: string }
  | { type: "tool_use"; id: string; name: string; args: Record<string, unknown> }
  | { type: "done" }
  | { type: "error"; message: string };

/** Provider interface — both adapters implement this. */
export interface ChatProvider {
  stream(
    messages: ChatMessage[],
    tools: ToolDef[],
    signal: AbortSignal,
  ): AsyncIterable<Delta>;
}
