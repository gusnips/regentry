import { describe, it, expect } from "vitest";
import { byCredentialStatus, credentialStatus, isOAuthProvider } from "../status";
import type { ProviderConfig } from "../types";

function config(over: Partial<ProviderConfig> & Pick<ProviderConfig, "id">): ProviderConfig {
  return {
    name: over.id,
    shape: "openai",
    baseUrl: "https://api.example.com/v1",
    apiKey: "",
    createdAt: 0,
    ...over,
  };
}

const auth = { accessToken: "at", refreshToken: "rt", expiresAt: Date.now() + 60_000 };

describe("credentialStatus", () => {
  it("counts a pasted key as connected", () => {
    expect(credentialStatus(config({ id: "openai", apiKey: "sk-1" }))).toBe("connected");
    expect(credentialStatus(config({ id: "openai" }))).toBe("missing");
  });

  it("treats a local endpoint as connected without any credential", () => {
    // Ollama needs no key — showing it as broken would be a lie.
    expect(credentialStatus(config({ id: "ollama", baseUrl: "http://localhost:11434/v1" }))).toBe(
      "connected",
    );
  });

  it("judges an OAuth provider by its sign-in, not by the empty apiKey", () => {
    expect(credentialStatus(config({ id: "kimi-plan" }))).toBe("missing");
    expect(credentialStatus(config({ id: "kimi-plan", auth }))).toBe("connected");
  });

  it("stays connected on a stale token — the next run refreshes it silently", () => {
    const stale = { ...auth, expiresAt: Date.now() - 60_000 };
    expect(credentialStatus(config({ id: "kimi-plan", auth: stale }))).toBe("connected");
  });
});

describe("isOAuthProvider", () => {
  it("distinguishes the two Kimi rows — same endpoint, different credential", () => {
    expect(isOAuthProvider("kimi-plan")).toBe(true);
    expect(isOAuthProvider("kimi")).toBe(false);
    expect(isOAuthProvider("custom-123")).toBe(false);
  });
});

describe("byCredentialStatus", () => {
  it("puts usable providers first and keeps original order within a group", () => {
    const list = [
      config({ id: "openai" }), // missing
      config({ id: "anthropic", apiKey: "sk-a" }), // connected
      config({ id: "kimi-plan" }), // missing
      config({ id: "kimi", apiKey: "sk-k" }), // connected
    ];
    expect([...list].sort(byCredentialStatus).map((p) => p.id)).toEqual([
      "anthropic",
      "kimi",
      "openai",
      "kimi-plan",
    ]);
  });
});
