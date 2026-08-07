import type { ChatProvider, ChatMessage, Delta, ProviderConfig } from "./types";

/**
 * Anthropic-shape adapter.
 * Streams SSE from POST /v1/messages.
 *
 * ponytail: MV3 service worker with host_permissions should bypass CORS.
 * If a direct browser-access error occurs, the user may need to add the
 * 'anthropic-dangerous-direct-browser-access' header. We set it proactively.
 */
export function createAnthropicProvider(config: ProviderConfig): ChatProvider {
  return {
    async *stream(messages, tools, signal): AsyncIterable<Delta> {
      const url = `${config.baseUrl.replace(/\/$/, "")}/v1/messages`;
      let toolCallBuffer: { id: string; name: string; args: string } | null = null;

      // Anthropic splits system from conversation
      const systemMsg = messages.find((m) => m.role === "system");
      const conversation = messages.filter((m) => m.role !== "system");

      const body: Record<string, unknown> = {
        model: config.model,
        max_tokens: 4096,
        stream: true,
        messages: conversation.map(toAnthropicMessage),
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

      const res = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": config.apiKey,
          "anthropic-version": "2023-06-01",
          "anthropic-dangerous-direct-browser-access": "true",
        },
        body: JSON.stringify(body),
        signal,
      });

      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(`Anthropic API error ${res.status}: ${text || res.statusText}`);
      }

      if (!res.body) throw new Error("No response body");

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

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

            let event: AnthropicSSE;
            try {
              event = JSON.parse(trimmed.slice(5).trim());
            } catch {
              continue;
            }

            switch (event.type) {
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
                if (delta?.type === "input_json_delta" && toolCallBuffer) {
                  toolCallBuffer.args += delta.partial_json ?? "";
                }
                break;
              }
              case "content_block_stop": {
                if (toolCallBuffer) {
                  let parsed: Record<string, unknown> = {};
                  try {
                    parsed = toolCallBuffer.args ? JSON.parse(toolCallBuffer.args) : {};
                  } catch {
                    // Partial JSON
                  }
                  yield {
                    type: "tool_use",
                    id: toolCallBuffer.id,
                    name: toolCallBuffer.name,
                    args: parsed,
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
        }
      } finally {
        reader.releaseLock();
      }

      yield { type: "done" };
    },
  };
}

interface AnthropicSSE {
  type: string;
  content_block?: { type: string; id?: string; name?: string };
  delta?: {
    type: string;
    text?: string;
    partial_json?: string;
  };
}

function toAnthropicMessage(msg: ChatMessage) {
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
  if (msg.role === "tool" && msg.toolCallId) {
    return {
      role: "user" as const,
      content: [
        {
          type: "tool_result" as const,
          tool_use_id: msg.toolCallId,
          content: msg.content,
        },
      ],
    };
  }
  return { role: msg.role, content: msg.content };
}
