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
});
