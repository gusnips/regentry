import { describe, it, expect, vi } from "vitest";
import { buildOpenAIBody } from "../openai";
import { buildAnthropicBody } from "../anthropic";
import type { ChatMessage, ResolvedProviderConfig } from "../types";

// The adapters import @/i18n, whose locale item reads wxt storage at module
// scope — no chrome in tests, so stub the storage driver.
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
});
