import { describe, it, expect, vi, afterEach } from "vitest";
import { listModels, pickLatestModel, resolveProviderModel } from "../models";
import { ProviderError } from "../types";
import type { ProviderConfig } from "../types";

const anthropicConfig: ProviderConfig = {
  id: "kimi",
  name: "Kimi",
  shape: "anthropic",
  baseUrl: "https://api.kimi.com/coding",
  apiKey: "sk-test",
  createdAt: 0,
};

const openaiConfig: ProviderConfig = {
  ...anthropicConfig,
  id: "openai",
  shape: "openai",
  baseUrl: "https://api.openai.com/v1",
};

function stubFetch(status: number, body: unknown) {
  const mock = vi.fn(
    async (_input: RequestInfo | URL, _init?: RequestInit) =>
      new Response(JSON.stringify(body), { status }),
  );
  vi.stubGlobal("fetch", mock);
  return mock;
}

afterEach(() => vi.unstubAllGlobals());

describe("listModels", () => {
  it("hits /v1/models with dual auth on anthropic shape and normalizes created_at", async () => {
    const mock = stubFetch(200, {
      data: [
        { id: "kimi-for-coding", created: 1761264000, created_at: "2025-10-24T00:00:00Z" },
        { id: "k3", created_at: "2026-07-16T00:00:00Z" },
      ],
    });
    const models = await listModels(anthropicConfig);
    const [url, init] = mock.mock.calls[0]!;
    expect(url).toBe("https://api.kimi.com/coding/v1/models");
    const headers = init?.headers as Record<string, string>; // fetch init headers, set by listModels
    expect(headers["x-api-key"]).toBe("sk-test");
    expect(headers.Authorization).toBe("Bearer sk-test");
    expect(models).toEqual([
      { id: "kimi-for-coding", created: 1761264000000 },
      { id: "k3", created: Date.parse("2026-07-16T00:00:00Z") },
    ]);
  });

  it("hits /models on openai shape and filters non-chat models out of big catalogs", async () => {
    const mock = stubFetch(200, {
      data: [
        { id: "gpt-5", created: 1760000000 },
        { id: "text-embedding-3-large", created: 1760000001 },
        { id: "whisper-1", created: 1760000002 },
        { id: "dall-e-3", created: 1760000003 },
        { id: "gpt-4o", created: 1750000000 },
      ],
    });
    const models = await listModels(openaiConfig);
    expect(mock.mock.calls[0]![0]).toBe("https://api.openai.com/v1/models");
    expect(models.map((m) => m.id)).toEqual(["gpt-5", "gpt-4o"]);
  });

  it("throws ProviderError with status on non-OK", async () => {
    stubFetch(404, { message: "Not support" });
    const err = await listModels(anthropicConfig).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ProviderError);
    expect((err as ProviderError).status).toBe(404);
  });
});

describe("pickLatestModel", () => {
  it("picks the newest by created", () => {
    expect(
      pickLatestModel([
        { id: "old", created: 1000 },
        { id: "new", created: 2000 },
        { id: "mid", created: 1500 },
      ])?.id,
    ).toBe("new");
  });

  it("falls back to list order when timestamps are missing", () => {
    expect(pickLatestModel([{ id: "a" }, { id: "b" }])?.id).toBe("b");
  });
});

describe("resolveProviderModel", () => {
  it("returns the persisted model without fetching", async () => {
    const mock = stubFetch(200, { data: [] });
    const resolved = await resolveProviderModel({ ...anthropicConfig, model: "k3[1m]" });
    expect(resolved.model).toBe("k3[1m]");
    expect(mock).not.toHaveBeenCalled();
  });

  it("auto-resolves to the newest listed model", async () => {
    stubFetch(200, {
      data: [
        { id: "kimi-for-coding", created: 1761264000 },
        { id: "k3", created: 1780000000 },
      ],
    });
    const resolved = await resolveProviderModel(anthropicConfig);
    expect(resolved.model).toBe("k3");
  });

  it("falls back to the preset's first model when the endpoint can't list", async () => {
    stubFetch(404, {});
    const resolved = await resolveProviderModel(anthropicConfig);
    expect(resolved.model).toBe("k3"); // first entry of the refreshed kimi preset
  });

  it("throws a clear error when nothing can resolve a model", async () => {
    stubFetch(404, {});
    const custom = { ...anthropicConfig, id: "custom-1", name: "My box" };
    await expect(resolveProviderModel(custom)).rejects.toThrow(/Pick a model in Settings/);
  });
});
