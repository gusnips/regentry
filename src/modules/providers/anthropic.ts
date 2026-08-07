import type { ChatProvider, ChatMessage, Delta, ResolvedProviderConfig, ToolDef } from "./types";
import { anthropicHeaders, apiUrl, parseToolArgs, streamSse } from "./http";

/** Anthropic-shape adapter — streams SSE from POST /v1/messages. */
export function createAnthropicProvider(config: ResolvedProviderConfig): ChatProvider {
  return {
    async *stream(messages, tools, signal): AsyncIterable<Delta> {
      let toolCallBuffer: { id: string; name: string; args: string } | null = null;
      let inputTokens = 0;

      const stream = streamSse({
        url: apiUrl(config.baseUrl, "/v1/messages"),
        headers: anthropicHeaders(config.apiKey),
        body: JSON.stringify(buildAnthropicBody(config, messages, tools)),
        label: "Anthropic",
        signal,
        meta: {
          model: config.model,
          messages: messages.length,
          tools: tools.length,
          effort: config.reasoningEffort ?? "default",
        },
      });

      for await (const data of stream) {
        let event: AnthropicSSE;
        try {
          event = JSON.parse(data);
        } catch {
          continue;
        }

        switch (event.type) {
          case "message_start": {
            inputTokens = event.message?.usage?.input_tokens ?? 0;
            break;
          }
          case "message_delta": {
            // Carries stop_reason and cumulative output usage
            if (event.delta?.stop_reason) {
              yield { type: "finish", reason: mapStopReason(event.delta.stop_reason) };
            }
            yield {
              type: "usage",
              input: inputTokens,
              output: event.usage?.output_tokens ?? 0,
            };
            break;
          }
          case "content_block_start": {
            if (event.content_block?.type === "tool_use") {
              toolCallBuffer = {
                id: event.content_block.id ?? "",
                name: event.content_block.name ?? "",
                args: "",
              };
            }
            break;
          }
          case "content_block_delta": {
            const delta = event.delta;
            if (delta?.type === "text_delta") {
              yield { type: "text", text: delta.text ?? "" };
            }
            if (delta?.type === "thinking_delta") {
              yield { type: "reasoning", text: delta.thinking ?? "" };
            }
            if (delta?.type === "input_json_delta" && toolCallBuffer) {
              toolCallBuffer.args += delta.partial_json ?? "";
            }
            break;
          }
          case "content_block_stop": {
            if (toolCallBuffer) {
              yield {
                type: "tool_use",
                id: toolCallBuffer.id,
                name: toolCallBuffer.name,
                args: parseToolArgs(toolCallBuffer.args),
              };
              toolCallBuffer = null;
            }
            break;
          }
          case "message_stop": {
            yield { type: "done" };
            return;
          }
        }
      }

      yield { type: "done" };
    },
  };
}

const MAX_OUTPUT_TOKENS = 4096;
const MAX_THINKING_OUTPUT_TOKENS = 65536;

/** Request body for POST /v1/messages. Exported for tests. */
export function buildAnthropicBody(
  config: ResolvedProviderConfig,
  messages: ChatMessage[],
  tools: ToolDef[],
): Record<string, unknown> {
  // Anthropic splits system from conversation
  const systemMsg = messages.find((m) => m.role === "system");
  const conversation = messages.filter((m) => m.role !== "system");

  const body: Record<string, unknown> = {
    model: config.model,
    // Thinking tokens count against max_tokens. With adaptive thinking on, the
    // cap must exceed the budget the provider assigns (coding-plan gateways
    // reject the request otherwise — seen: 32768) and still leave room for the
    // answer; without thinking it's answer-only headroom.
    max_tokens: config.reasoningEffort ? MAX_THINKING_OUTPUT_TOKENS : MAX_OUTPUT_TOKENS,
    stream: true,
    // tool_results and an injected mid-run message both serialize as user
    // messages, and can land back to back — merge them, Anthropic rejects
    // consecutive same-role messages.
    messages: mergeConsecutiveUsers(conversation.map(toAnthropicMessage)),
  };

  if (systemMsg) {
    body.system = systemMsg.content;
  }

  if (tools.length > 0) {
    body.tools = tools.map((t) => ({
      name: t.name,
      description: t.description,
      input_schema: t.params,
    }));
  }

  if (config.reasoningEffort) {
    body.thinking = { type: "adaptive" };
    // "none" has no Anthropic equivalent — adaptive thinking alone lets Claude
    // decide to skip reasoning; the other levels pin output_config.effort.
    if (config.reasoningEffort !== "none") {
      body.output_config = { effort: config.reasoningEffort };
    }
  }

  return body;
}

interface AnthropicSSE {
  type: string;
  content_block?: { type: string; id?: string; name?: string };
  message?: { usage?: { input_tokens?: number } };
  usage?: { output_tokens?: number };
  delta?: {
    type: string;
    text?: string;
    thinking?: string;
    partial_json?: string;
    stop_reason?: string;
  };
}

function mapStopReason(reason: string): "stop" | "length" | "tool_use" | "unknown" {
  if (reason === "end_turn") return "stop";
  if (reason === "max_tokens") return "length";
  if (reason === "tool_use") return "tool_use";
  return "unknown";
}

/**
 * `data:image/jpeg;base64,…` → an Anthropic image block. Anthropic takes the
 * media type and payload as separate fields; it does not accept a data URL.
 * A malformed URL falls back to png rather than throwing mid-request.
 */
function toImageBlock(dataUrl: string) {
  const match = /^data:([^;,]+);base64,(.*)$/s.exec(dataUrl);
  return {
    type: "image" as const,
    source: {
      type: "base64" as const,
      media_type: match?.[1] ?? "image/png",
      data: match?.[2] ?? "",
    },
  };
}

interface AnthropicMessage {
  role: "user" | "assistant";
  content: string | Array<Record<string, unknown>>;
}

function asBlocks(
  content: string | Array<Record<string, unknown>>,
): Array<Record<string, unknown>> {
  return typeof content === "string" ? [{ type: "text", text: content }] : content;
}

/** See buildAnthropicBody for why the merge exists. */
function mergeConsecutiveUsers(messages: AnthropicMessage[]): AnthropicMessage[] {
  const merged: AnthropicMessage[] = [];
  for (const msg of messages) {
    const prev = merged[merged.length - 1];
    if (prev?.role === "user" && msg.role === "user") {
      prev.content = [...asBlocks(prev.content), ...asBlocks(msg.content)];
    } else {
      merged.push({ ...msg });
    }
  }
  return merged;
}

export function toAnthropicMessage(msg: ChatMessage) {
  if (msg.role === "assistant" && msg.toolCalls) {
    return {
      role: "assistant" as const,
      content: [
        ...(msg.content ? [{ type: "text", text: msg.content }] : []),
        ...msg.toolCalls.map((tc) => ({
          type: "tool_use" as const,
          id: tc.id,
          name: tc.name,
          input: tc.args,
        })),
      ],
    };
  }
  if (msg.role === "tool_results") {
    // Anthropic: all results collapse into ONE user message of tool_result blocks.
    // Screenshots nest directly inside their own result — no trailing message needed.
    return {
      role: "user" as const,
      content: (msg.toolResults ?? []).map((r) => ({
        type: "tool_result" as const,
        tool_use_id: r.id,
        content: r.images?.length
          ? [{ type: "text" as const, text: r.content }, ...r.images.map(toImageBlock)]
          : r.content,
      })),
    };
  }
  if (msg.role === "user" && msg.images?.length) {
    return {
      role: "user" as const,
      content: [{ type: "text" as const, text: msg.content }, ...msg.images.map(toImageBlock)],
    };
  }
  return { role: msg.role as "user" | "assistant", content: msg.content };
}
