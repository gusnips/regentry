import { describe, it, expect, vi, beforeAll } from "vitest";
import { createOpenAIProvider } from "../openai";
import { createAnthropicProvider } from "../anthropic";
import type { ResolvedProviderConfig } from "../types";
import { i18n } from "@/i18n";
import en from "@/i18n/locales/en.json";

// @/i18n's locale item reads wxt storage at module scope — no chrome in tests,
// so stub the storage driver.
vi.mock("wxt/utils/storage", () => ({
  storage: {
    defineItem: (_key: string, opts?: { fallback?: unknown }) => {
      let value: unknown = opts?.fallback ?? null;
      return {
        getValue: async () => value,
        setValue: async (v: unknown) => void (value = v),
        removeValue: async () => void (value = null),
        watch: () => () => {},
      };
    },
  },
}));

// The production initI18n reads wxt storage — tests load the en catalog directly.
beforeAll(async () => {
  await i18n.init({
    resources: { en: { translation: en } },
    lng: "en",
    interpolation: { escapeValue: false },
    returnEmptyString: false,
  });
});

function makeConfig(shape: "openai" | "anthropic", baseUrl: string): ResolvedProviderConfig {
  return {
    id: "test",
    name: "Test",
    shape,
    baseUrl,
    apiKey: "sk-test",
    model: "test-model",
    createdAt: 0,
  };
}

/** Build a ReadableStream from SSE lines. */
function sseStream(lines: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const line of lines) controller.enqueue(encoder.encode(line + "\n"));
      controller.close();
    },
  });
}

describe("OpenAI provider SSE parsing", () => {
  it("parses text deltas", async () => {
    const config = makeConfig("openai", "https://api.openai.com/v1");
    const provider = createOpenAIProvider(config);

    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(
        sseStream([
          `data: ${JSON.stringify({ choices: [{ delta: { content: "Hello" } }] })}`,
          `data: ${JSON.stringify({ choices: [{ delta: { content: " world" } }] })}`,
          "data: [DONE]",
        ]),
        { status: 200, headers: { "content-type": "text/event-stream" } },
      ),
    );

    const deltas = [];
    for await (const d of provider.stream([], [], new AbortController().signal)) {
      deltas.push(d);
    }

    expect(deltas).toContainEqual({ type: "text", text: "Hello" });
    expect(deltas).toContainEqual({ type: "text", text: " world" });
    expect(deltas[deltas.length - 1]).toEqual({ type: "done" });
    vi.restoreAllMocks();
  });

  it("accumulates tool call args across chunks", async () => {
    const config = makeConfig("openai", "https://api.openai.com/v1");
    const provider = createOpenAIProvider(config);

    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(
        sseStream([
          `data: ${JSON.stringify({
            choices: [
              {
                delta: {
                  tool_calls: [
                    { index: 0, id: "call_1", function: { name: "click", arguments: '{"ref":' } },
                  ],
                },
              },
            ],
          })}`,
          `data: ${JSON.stringify({
            choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: '"e1"}' } }] } }],
          })}`,
          "data: [DONE]",
        ]),
        { status: 200, headers: { "content-type": "text/event-stream" } },
      ),
    );

    const deltas = [];
    for await (const d of provider.stream([], [], new AbortController().signal)) {
      deltas.push(d);
    }

    const toolUse = deltas.find((d) => d.type === "tool_use");
    expect(toolUse).toEqual({ type: "tool_use", id: "call_1", name: "click", args: { ref: "e1" } });
    vi.restoreAllMocks();
  });

  it("yields reasoning_content as reasoning, separate from text", async () => {
    const config = makeConfig("openai", "https://api.openai.com/v1");
    const provider = createOpenAIProvider(config);

    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(
        sseStream([
          `data: ${JSON.stringify({ choices: [{ delta: { reasoning_content: "Let me check" } }] })}`,
          `data: ${JSON.stringify({ choices: [{ delta: { content: "Answer" } }] })}`,
          "data: [DONE]",
        ]),
        { status: 200, headers: { "content-type": "text/event-stream" } },
      ),
    );

    const deltas = [];
    for await (const d of provider.stream([], [], new AbortController().signal)) {
      deltas.push(d);
    }

    expect(deltas).toContainEqual({ type: "reasoning", text: "Let me check" });
    expect(deltas).toContainEqual({ type: "text", text: "Answer" });
    vi.restoreAllMocks();
  });

  it("throws on non-200 response", async () => {
    const config = makeConfig("openai", "https://api.openai.com/v1");
    const provider = createOpenAIProvider(config);

    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response("Unauthorized", { status: 401 }),
    );

    await expect(
      (async () => {
        for await (const delta of provider.stream([], [], new AbortController().signal)) {
          void delta;
        }
      })(),
    ).rejects.toThrow("OpenAI API error 401");
    vi.restoreAllMocks();
  });
});

describe("Anthropic provider SSE parsing", () => {
  it("parses text deltas", async () => {
    const config = makeConfig("anthropic", "https://api.anthropic.com");
    const provider = createAnthropicProvider(config);

    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(
        sseStream([
          `data: ${JSON.stringify({ type: "content_block_delta", delta: { type: "text_delta", text: "Hello" } })}`,
          `data: ${JSON.stringify({ type: "content_block_delta", delta: { type: "text_delta", text: " world" } })}`,
          `data: ${JSON.stringify({ type: "message_stop" })}`,
        ]),
        { status: 200, headers: { "content-type": "text/event-stream" } },
      ),
    );

    const deltas = [];
    for await (const d of provider.stream([], [], new AbortController().signal)) {
      deltas.push(d);
    }

    expect(deltas).toContainEqual({ type: "text", text: "Hello" });
    expect(deltas).toContainEqual({ type: "text", text: " world" });
    expect(deltas[deltas.length - 1]).toEqual({ type: "done" });
    vi.restoreAllMocks();
  });

  it("parses tool use across content block lifecycle", async () => {
    const config = makeConfig("anthropic", "https://api.anthropic.com");
    const provider = createAnthropicProvider(config);

    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(
        sseStream([
          `data: ${JSON.stringify({ type: "content_block_start", content_block: { type: "tool_use", id: "tu_1", name: "click" } })}`,
          `data: ${JSON.stringify({ type: "content_block_delta", delta: { type: "input_json_delta", partial_json: '{"ref":' } })}`,
          `data: ${JSON.stringify({ type: "content_block_delta", delta: { type: "input_json_delta", partial_json: '"e1"}' } })}`,
          `data: ${JSON.stringify({ type: "content_block_stop" })}`,
          `data: ${JSON.stringify({ type: "message_stop" })}`,
        ]),
        { status: 200, headers: { "content-type": "text/event-stream" } },
      ),
    );

    const deltas = [];
    for await (const d of provider.stream([], [], new AbortController().signal)) {
      deltas.push(d);
    }

    const toolUse = deltas.find((d) => d.type === "tool_use");
    expect(toolUse).toEqual({ type: "tool_use", id: "tu_1", name: "click", args: { ref: "e1" } });
    vi.restoreAllMocks();
  });

  it("yields thinking_delta as reasoning, separate from text", async () => {
    const config = makeConfig("anthropic", "https://api.anthropic.com");
    const provider = createAnthropicProvider(config);

    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(
        sseStream([
          `data: ${JSON.stringify({ type: "content_block_delta", delta: { type: "thinking_delta", thinking: "Let me check" } })}`,
          `data: ${JSON.stringify({ type: "content_block_delta", delta: { type: "text_delta", text: "Answer" } })}`,
          `data: ${JSON.stringify({ type: "message_stop" })}`,
        ]),
        { status: 200, headers: { "content-type": "text/event-stream" } },
      ),
    );

    const deltas = [];
    for await (const d of provider.stream([], [], new AbortController().signal)) {
      deltas.push(d);
    }

    expect(deltas).toContainEqual({ type: "reasoning", text: "Let me check" });
    expect(deltas).toContainEqual({ type: "text", text: "Answer" });
    vi.restoreAllMocks();
  });

  it("throws on non-200 response", async () => {
    const config = makeConfig("anthropic", "https://api.anthropic.com");
    const provider = createAnthropicProvider(config);

    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response("rate limited", { status: 429 }),
    );

    await expect(
      (async () => {
        for await (const delta of provider.stream([], [], new AbortController().signal)) {
          void delta;
        }
      })(),
    ).rejects.toThrow("Anthropic API error 429");
    vi.restoreAllMocks();
  });
});
