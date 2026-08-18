import type { ChatProvider, ChatMessage, Delta, ResolvedProviderConfig, ToolDef } from "./types";
import { anthropicHeaders, anthropicOAuthHeaders, apiUrl, parseToolArgs, streamSse } from "./http";

/**
 * Claude Code identities the subscription token as theirs, so OAuth traffic
 * must wear its two signatures: a `custom_` tool-name prefix (the server
 * strips it before the model sees the name) and a first system block naming
 * the agent SDK.
 */
const CLAUDE_IDENTITY = "You are a Claude agent, built on Anthropic's Claude Agent SDK.";
const TOOL_PREFIX = "custom_";

/** Anthropic-shape adapter — streams SSE from POST /v1/messages. */
export function createAnthropicProvider(config: ResolvedProviderConfig): ChatProvider {
  return {
    async *stream(messages, tools, signal): AsyncIterable<Delta> {
      let toolCallBuffer: { id: string; name: string; args: string } | null = null;
      let inputTokens = 0;

      const stream = streamSse({
        url: apiUrl(config.baseUrl, "/v1/messages"),
        // A signed-in subscription provider sends the access token as a Bearer
        // and talks OAuth-token mode; a key provider sends x-api-key.
        headers: config.auth
          ? anthropicOAuthHeaders(config.apiKey)
          : anthropicHeaders(config.apiKey),
        body: JSON.stringify(buildAnthropicBody(config, messages, tools)),
        provider: config,
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
                // The model echoes prefixed names back in OAuth mode — the wire
                // is "custom_*", the loop only ever sees the unprefixed name.
                name: stripToolPrefix(event.content_block.name ?? ""),
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

const MAX_THINKING_OUTPUT_TOKENS = 65536;

/** Request body for POST /v1/messages. Exported for tests. */
export function buildAnthropicBody(
  config: ResolvedProviderConfig,
  messages: ChatMessage[],
  tools: ToolDef[],
): Record<string, unknown> {
  // Anthropic splits system from conversation. OAuth traffic additionally
  // prepends the client-identity block and prefixes every tool name.
  const isOAuth = Boolean(config.auth);
  const systemMsg = messages.find((m) => m.role === "system");
  const conversation = messages.filter((m) => m.role !== "system");

  const body: Record<string, unknown> = {
    model: config.model,
    // Thinking tokens count against max_tokens, and thinking is always on here
    // now, so the cap is unconditional: it must exceed the budget the provider
    // assigns (coding-plan gateways reject the request otherwise — seen: 32768)
    // and still leave room for the answer.
    max_tokens: MAX_THINKING_OUTPUT_TOKENS,
    stream: true,
    // tool_results and an injected mid-run message both serialize as user
    // messages, and can land back to back — merge them, Anthropic rejects
    // consecutive same-role messages.
    messages: mergeConsecutiveUsers(conversation.map((m) => toAnthropicMessage(m, isOAuth))),
  };

  if (systemMsg) {
    body.system = isOAuth
      ? [
          { type: "text", text: CLAUDE_IDENTITY },
          { type: "text", text: systemMsg.content },
        ]
      : systemMsg.content;
  } else if (isOAuth) {
    body.system = [{ type: "text", text: CLAUDE_IDENTITY }];
  }

  if (tools.length > 0) {
    body.tools = tools.map((t) => ({
      name: isOAuth ? `${TOOL_PREFIX}${t.name}` : t.name,
      description: t.description,
      input_schema: t.params,
    }));
  }

  // Adaptive thinking is this shape's floor, not an opt-in. Sending no thinking
  // field at all — what an unpinned effort used to do — is the one shape where
  // "default" meant reasoning *off*: the OpenAI and Responses shapes leave the
  // model to its own default, which for a current reasoning model is not off.
  // Adaptive costs nothing on a step that doesn't need it, since Claude decides
  // per turn, and it can't 400 a model that doesn't reason.
  body.thinking = { type: "adaptive" };
  // "none" has no Anthropic equivalent — there is no off switch, so it lands on
  // the same adaptive floor as an unpinned effort, and only the other levels pin
  // output_config.effort. That makes "none" and "default" one request on this
  // shape; telling them apart needs an API answer we don't have, not a code change.
  if (config.reasoningEffort && config.reasoningEffort !== "none") {
    body.output_config = { effort: config.reasoningEffort };
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

/** Idempotent — the non-OAuth path streams unprefixed names and is untouched. */
function stripToolPrefix(name: string): string {
  return name.startsWith(TOOL_PREFIX) ? name.slice(TOOL_PREFIX.length) : name;
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

export function toAnthropicMessage(msg: ChatMessage, isOAuth = false) {
  if (msg.role === "assistant" && msg.toolCalls) {
    return {
      role: "assistant" as const,
      content: [
        ...(msg.content ? [{ type: "text", text: msg.content }] : []),
        // Replayed tool_use names ride the same prefixed wire as the tools we
        // declared, so a resumed OAuth run re-prefixes them on the way out.
        ...msg.toolCalls.map((tc) => ({
          type: "tool_use" as const,
          id: tc.id,
          name: isOAuth ? `${TOOL_PREFIX}${tc.name}` : tc.name,
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
