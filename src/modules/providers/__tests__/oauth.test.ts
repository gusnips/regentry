import { describe, it, expect, vi, afterEach } from "vitest";
import { generatePKCE, postToken, toCredential } from "../oauth";
import { ProviderError } from "../types";

// Storage stand-in and i18n come from src/test-setup.ts (vitest setupFiles).

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

const TOKENS = { access_token: "at", refresh_token: "rt", expires_in: 3600 };

afterEach(() => vi.restoreAllMocks());

describe("generatePKCE", () => {
  it("produces a verifier whose S256 challenge matches, both base64url", async () => {
    const { verifier, challenge } = await generatePKCE();
    expect(verifier).toMatch(/^[A-Za-z0-9_-]{43,128}$/);
    expect(challenge).toMatch(/^[A-Za-z0-9_-]{43}$/); // 32-byte digest, unpadded

    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
    const expected = btoa(String.fromCharCode(...new Uint8Array(digest)))
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");
    expect(challenge).toBe(expected);
  });
});

describe("postToken", () => {
  it("takes a token pair as success whatever the status says", async () => {
    // Anthropic answers 429 for a plan over its usage limit AND hands back the
    // tokens — throwing there would force a pointless re-login.
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(json(TOKENS, 429));
    await expect(postToken("https://x/token", {}, { encode: "json" })).resolves.toMatchObject({
      access_token: "at",
    });
  });

  it("fails a 429 that carries no token — nobody is signed in", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(json({ error: "rate_limited" }, 429));
    const error = await postToken("https://x/token", {}, { encode: "json" }).catch(
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(ProviderError);
    expect((error as ProviderError).status).toBe(429);
  });

  it("surfaces the vendor's own reason on a plain failure", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      json({ error_description: "code already used" }, 400),
    );
    await expect(postToken("https://x/token", {}, { encode: "form" })).rejects.toThrow(
      /code already used/,
    );
  });

  it("hands back 4xx bodies when the caller reads them — the device poll's pending answer", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      json({ error: "authorization_pending" }, 400),
    );
    await expect(
      postToken("https://x/token", {}, { encode: "form", allowErrorBody: true }),
    ).resolves.toMatchObject({ error: "authorization_pending" });
  });

  it("encodes json or form per the vendor's endpoint", async () => {
    const mock = vi.spyOn(globalThis, "fetch").mockResolvedValue(json(TOKENS));
    await postToken("https://x/token", { a: "1" }, { encode: "json" });
    await postToken("https://x/token", { a: "1" }, { encode: "form" });
    expect(mock.mock.calls[0]?.[1]?.body).toBe('{"a":"1"}');
    expect(mock.mock.calls[1]?.[1]?.body).toBe("a=1");
  });
});

describe("toCredential", () => {
  it("bakes the refresh skew into expiresAt so readers need no margin", () => {
    const before = Date.now();
    const credential = toCredential(TOKENS);
    // 1h lifetime, 5min skew → ~55min out, never the raw hour.
    expect(credential.expiresAt).toBeGreaterThan(before + 54 * 60_000);
    expect(credential.expiresAt).toBeLessThan(before + 56 * 60_000);
  });

  it("throws on a half-built credential instead of storing one", () => {
    expect(() => toCredential({ access_token: "at" })).toThrow();
  });
});
