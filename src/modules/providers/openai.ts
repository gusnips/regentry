import type { ChatProvider, ChatMessage, ToolDef, Delta, ProviderConfig } from "./types";
import { ProviderError } from "./types";

/**
 * OpenAI-shape adapter — works with any OpenAI-compatible endpoint.
 * Streams SSE from POST /chat/completions.
 */
export function createOpenAIProvider(config: ProviderConfig): ChatProvider {
  return {
    async *stream(messages, tools, signal): AsyncIterable<Delta> {
      const url = `${config.baseUrl.replace(/\/$/, "")}/chat/completions`;

      const res = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${config.apiKey}`,
        },
        body: JSON.stringify(buildOpenAIBody(config, messages, tools)),
        signal,
      });

      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new ProviderError(
          `OpenAI API error ${res.status}: ${text || res.statusText}`,
          res.status,
        );
      }

      if (!res.body) throw new Error("No response body");

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      // Accumulate tool call args across chunks (OpenAI streams them in pieces)
      const toolCallAccumulators = new Map<number, { id: string; name: string; args: string }>();

      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });

          const lines = buffer.split("\n");
          buffer = lines.pop() ?? "";

          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed || !trimmed.startsWith("data:")) continue;

            const data = trimmed.slice(5).trim();
            if (data === "[DONE]") {
              // Emit accumulated tool calls
              for (const acc of toolCallAccumulators.values()) {
                let parsed: Record<string, unknown> = {};
                try {
                  parsed = acc.args ? JSON.parse(acc.args) : {};
                } catch {
                  // Partial JSON — skip, the model didn't finish
                }
                yield { type: "tool_use", id: acc.id, name: acc.name, args: parsed };
              }
              yield { type: "done" };
              return;
            }

            let chunk: OpenAIChunk;
            try {
              chunk = JSON.parse(data);
            } catch {
              continue;
            }

            // Final usage chunk (stream_options.include_usage) — choices is empty
            if (chunk.usage) {
              yield {
                type: "usage",
                input: chunk.usage.prompt_tokens ?? 0,
                output: chunk.usage.completion_tokens ?? 0,
              };
              continue;
            }

            const choice = chunk.choices?.[0];
            if (!choice) continue;

            if (choice.finish_reason) {
              yield { type: "finish", reason: mapFinishReason(choice.finish_reason) };
            }

            const delta = choice.delta;
            if (!delta) continue;

            if (delta.content) {
              yield { type: "text", text: delta.content };
            }

            if (delta.tool_calls) {
              for (const tc of delta.tool_calls) {
                const idx = tc.index ?? 0;
                const acc = toolCallAccumulators.get(idx);
                if (acc) {
                  if (tc.function?.arguments) acc.args += tc.function.arguments;
                } else {
                  toolCallAccumulators.set(idx, {
                    id: tc.id ?? `call_${idx}`,
                    name: tc.function?.name ?? "",
                    args: tc.function?.arguments ?? "",
                  });
                }
              }
            }
          }
        }
      } finally {
        reader.releaseLock();
      }

      yield { type: "done" };
    },
  };
}

/** Request body for POST /chat/completions. Exported for tests. */
export function buildOpenAIBody(
  config: ProviderConfig,
  messages: ChatMessage[],
  tools: ToolDef[],
): Record<string, unknown> {
  const body: Record<string, unknown> = {
    model: config.model,
    messages: messages.flatMap(toOpenAIMessages),
    stream: true,
    stream_options: { include_usage: true },
  };

  if (tools.length > 0) {
    body.tools = tools.map(toOpenAITool);
  }

  // Verbatim passthrough — the provider validates per-model support (400 if not).
  if (config.reasoningEffort) {
    body.reasoning_effort = config.reasoningEffort;
  }

  return body;
}

interface OpenAIChunk {
  choices?: {
    finish_reason?: string | null;
    delta?: {
      content?: string;
      tool_calls?: {
        index?: number;
        id?: string;
        function?: { name?: string; arguments?: string };
      }[];
    };
  }[];
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
  };
}

function mapFinishReason(reason: string): "stop" | "length" | "tool_use" | "unknown" {
  if (reason === "stop") return "stop";
  if (reason === "length") return "length";
  if (reason === "tool_calls" || reason === "function_call") return "tool_use";
  return "unknown";
}

interface OpenAIMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null;
  tool_call_id?: string;
  tool_calls?: OpenAIToolCall[];
}

export function toOpenAIMessages(msg: ChatMessage): OpenAIMessage[] {
  if (msg.role === "tool_results") {
    // OpenAI: one role:tool message per result
    return (msg.toolResults ?? []).map((r) => ({
      role: "tool" as const,
      content: r.content,
      tool_call_id: r.id,
    }));
  }
  if (msg.role === "assistant" && msg.toolCalls) {
    return [
      {
        role: "assistant" as const,
        content: msg.content || null,
        tool_calls: msg.toolCalls.map((tc): OpenAIToolCall => ({
          id: tc.id,
          type: "function",
          function: { name: tc.name, arguments: JSON.stringify(tc.args) },
        })),
      },
    ];
  }
  return [{ role: msg.role, content: msg.content }];
}

interface OpenAIToolCall {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}

function toOpenAITool(tool: ToolDef) {
  return {
    type: "function" as const,
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.params,
    },
  };
}
