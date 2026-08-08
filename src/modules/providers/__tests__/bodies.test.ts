import { describe, it, expect } from "vitest";
import { buildOpenAIBody } from "../openai";
import { buildAnthropicBody } from "../anthropic";
import type { ChatMessage, ResolvedProviderConfig } from "../types";

// Storage stand-in comes from src/test-setup.ts (vitest setupFiles).

const base: ResolvedProviderConfig = {
  id: "test",
  name: "Test",
  shape: "openai",
  baseUrl: "https://example.com/v1",
  apiKey: "sk-test",
  model: "test-model",
  createdAt: 0,
};

const messages: ChatMessage[] = [
  { role: "system", content: "You are an agent." },
  { role: "user", content: "Do the thing." },
];

describe("buildOpenAIBody", () => {
  it("omits reasoning_effort by default", () => {
    const body = buildOpenAIBody(base, messages, []);
    expect(body).not.toHaveProperty("reasoning_effort");
  });

  it("passes reasoning_effort through verbatim when set", () => {
    const body = buildOpenAIBody({ ...base, reasoningEffort: "max" }, messages, []);
    expect(body.reasoning_effort).toBe("max");
  });

  it("serializes tool-call assistant turns with string content and echoed reasoning", () => {
    // DeepSeek's strict deserializer reads null/absent content as a missing field,
    // and its thinking mode 400s unless reasoning_content is passed back verbatim.
    const body = buildOpenAIBody(
      base,
      [
        { role: "user", content: "Do the thing." },
        {
          role: "assistant",
          content: "",
          reasoning: "let me look at the page",
          toolCalls: [{ id: "c1", name: "snapshot", args: {} }],
        },
        { role: "tool_results", content: "", toolResults: [{ id: "c1", content: "{}" }] },
      ],
      [],
    );
    const msgs = body.messages as Record<string, unknown>[];
    expect(msgs[1]).toMatchObject({
      role: "assistant",
      content: "",
      reasoning_content: "let me look at the page",
    });
    expect(msgs[1]?.tool_calls).toHaveLength(1);
  });

  it("never omits `content` on tool messages (strict deserializers 400 otherwise)", () => {
    // A no-data tool (type, press_key, scroll) can produce content: undefined —
    // serializing that drops the key and DeepSeek rejects the body. The adapter
    // must always emit `content`, even when the result carried none.
    const body = buildOpenAIBody(
      base,
      [
        { role: "user", content: "Do the thing." },
        {
          role: "assistant",
          content: "",
          toolCalls: [{ id: "c1", name: "type", args: { text: "hi" } }],
        },
        {
          role: "tool_results",
          content: "",
          // as unknown as string: reproducing the runtime hole the type misses.
          toolResults: [{ id: "c1", content: undefined as unknown as string }],
        },
      ],
      [],
    );
    const msgs = body.messages as Record<string, unknown>[];
    expect(msgs[2]).toMatchObject({ role: "tool", tool_call_id: "c1", content: "" });
    expect(JSON.stringify(msgs[2])).toContain('"content"');
  });

  it("omits reasoning_content when the turn had no reasoning", () => {
    const body = buildOpenAIBody(base, [{ role: "assistant", content: "done" }], []);
    const msgs = body.messages as Record<string, unknown>[];
    expect(msgs[0]).not.toHaveProperty("reasoning_content");
  });
});

describe("buildAnthropicBody", () => {
  const anthropicBase: ResolvedProviderConfig = { ...base, shape: "anthropic" };

  it("splits system out of the conversation", () => {
    const body = buildAnthropicBody(anthropicBase, messages, []);
    expect(body.system).toBe("You are an agent.");
    expect(body.messages).toEqual([{ role: "user", content: "Do the thing." }]);
  });

  it("omits thinking config by default", () => {
    const body = buildAnthropicBody(anthropicBase, messages, []);
    expect(body).not.toHaveProperty("thinking");
    expect(body).not.toHaveProperty("output_config");
    expect(body.max_tokens).toBe(4096);
  });

  it("raises max_tokens above the thinking budget when thinking is on", () => {
    const body = buildAnthropicBody({ ...anthropicBase, reasoningEffort: "high" }, messages, []);
    expect(body.max_tokens).toBeGreaterThan(32768);
  });

  it("maps effort to adaptive thinking + output_config", () => {
    const body = buildAnthropicBody({ ...anthropicBase, reasoningEffort: "high" }, messages, []);
    expect(body.thinking).toEqual({ type: "adaptive" });
    expect(body.output_config).toEqual({ effort: "high" });
  });

  it("maps 'none' to adaptive thinking with no effort pin", () => {
    const body = buildAnthropicBody({ ...anthropicBase, reasoningEffort: "none" }, messages, []);
    expect(body.thinking).toEqual({ type: "adaptive" });
    expect(body).not.toHaveProperty("output_config");
  });

  it("merges back-to-back user messages (tool_results + injected mid-run note)", () => {
    // Anthropic rejects consecutive same-role messages; an injected user note
    // lands right after the tool_results user message and must merge into it.
    const body = buildAnthropicBody(
      anthropicBase,
      [
        { role: "user", content: "Do the thing." },
        {
          role: "assistant",
          content: "",
          toolCalls: [{ id: "c1", name: "snapshot", args: {} }],
        },
        { role: "tool_results", content: "", toolResults: [{ id: "c1", content: "{}" }] },
        { role: "user", content: "also check the footer" },
      ],
      [],
    );
    const msgs = body.messages as { role: string; content: unknown }[];
    expect(msgs).toHaveLength(3);
    expect(msgs[2]?.role).toBe("user");
    expect(msgs[2]?.content).toEqual([
      { type: "tool_result", tool_use_id: "c1", content: "{}" },
      { type: "text", text: "also check the footer" },
    ]);
  });

  describe("in OAuth mode", () => {
    // A signed-in subscription provider — the adapter must wear Claude Code's
    // wire signatures: identity system block + custom_ tool-name prefix.
    const oauth: ResolvedProviderConfig = {
      ...anthropicBase,
      auth: { accessToken: "at", refreshToken: "rt", expiresAt: 0 },
    };
    const tools = [
      {
        name: "snapshot",
        description: "Snapshot the page",
        params: { type: "object" as const, properties: {} },
      },
    ];

    it("prepends the Claude Code identity as the first system block", () => {
      const body = buildAnthropicBody(oauth, messages, []);
      expect(body.system).toEqual([
        { type: "text", text: "You are a Claude agent, built on Anthropic's Claude Agent SDK." },
        { type: "text", text: "You are an agent." },
      ]);
    });

    it("emits an identity block even when the conversation has no system message", () => {
      const body = buildAnthropicBody(oauth, [{ role: "user", content: "hi" }], []);
      expect((body.system as { text: string }[])[0]?.text).toContain("Claude Agent SDK");
    });

    it("prefixes declared tool names with custom_", () => {
      const body = buildAnthropicBody(oauth, messages, tools);
      expect((body.tools as { name: string }[])[0]?.name).toBe("custom_snapshot");
    });

    it("leaves key-based bodies untouched", () => {
      const body = buildAnthropicBody(anthropicBase, messages, tools);
      expect((body.tools as { name: string }[])[0]?.name).toBe("snapshot");
      expect(body.system).toBe("You are an agent.");
    });
  });
});
