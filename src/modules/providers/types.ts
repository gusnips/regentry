/** Provider shape — determines wire format for API calls. */
export type ProviderShape = "openai" | "anthropic";

/**
 * Reasoning effort — how hard the model thinks before acting.
 * Absent = provider default (never sent). Passed through verbatim on
 * OpenAI-shape (`reasoning_effort`); mapped to adaptive thinking +
 * `output_config.effort` on Anthropic-shape. Support varies per model —
 * an unsupported level comes back as a clean provider 400, surfaced in chat.
 */
export type ReasoningEffort = "none" | "low" | "medium" | "high" | "max";

/** A configured provider instance (stored in chrome.storage). */
export interface ProviderConfig {
  id: string;
  name: string;
  shape: ProviderShape;
  baseUrl: string;
  apiKey: string;
  /** Absent = auto — resolveProviderModel picks the newest model the endpoint serves. */
  model?: string;
  reasoningEffort?: ReasoningEffort;
  createdAt: number;
}

/** A config whose model has been resolved to a concrete id — what adapters accept. */
export interface ResolvedProviderConfig extends ProviderConfig {
  model: string;
}

/** One entry from a provider's model listing. `created` is epoch ms when the endpoint reports it. */
export interface ModelInfo {
  id: string;
  created?: number;
}

/** Chat message in provider-agnostic format. */
export interface ChatMessage {
  role: "system" | "user" | "assistant" | "tool_results";
  content: string;
  toolCalls?: ToolCall[];
  /** Results of tool calls from the previous assistant turn. Adapters serialize
   *  differently: OpenAI expands to N role:tool messages, Anthropic collapses
   *  to one user message with N tool_result blocks. */
  toolResults?: ToolResult[];
}

export interface ToolResult {
  id: string;
  content: string;
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
  /** Model reasoning (Anthropic thinking blocks, OpenAI-shape reasoning_content) — display only,
   *  never committed to the outgoing conversation. */
  | { type: "reasoning"; text: string }
  | { type: "tool_use"; id: string; name: string; args: Record<string, unknown> }
  | { type: "usage"; input: number; output: number }
  | { type: "finish"; reason: "stop" | "length" | "tool_use" | "unknown" }
  | { type: "done" }
  | { type: "error"; message: string };

/** Provider error with HTTP status so the loop can classify retryability. */
export class ProviderError extends Error {
  constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message);
    this.name = "ProviderError";
  }
}

/** 429 and 5xx are transient — retry in place. 4xx auth/request errors are not. */
export function isRetryable(e: unknown): boolean {
  if (e instanceof ProviderError) return e.status === 429 || e.status >= 500;
  // Network-level failures (TypeError from fetch) have no status — retryable
  return e instanceof TypeError;
}

/** Provider interface — both adapters implement this. */
export interface ChatProvider {
  stream(messages: ChatMessage[], tools: ToolDef[], signal: AbortSignal): AsyncIterable<Delta>;
}
