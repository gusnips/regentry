import { describe, it, expect, vi, afterEach } from "vitest";
import {
  accountFromToken,
  buildAuthorizeUrl,
  exchangeCode,
  generatePKCE,
  refreshCredential,
} from "../claude-oauth";

// Storage stand-in and i18n come from src/test-setup.ts (vitest setupFiles).

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

/** A JWT whose payload is `claims` — signature is never checked, only decoded. */
function jwt(claims: Record<string, unknown>): string {
  const payload = btoa(JSON.stringify(claims)).replace(/\+/g, "-").replace(/\//g, "_");
  return `header.${payload}.signature`;
}

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

describe("buildAuthorizeUrl", () => {
  it("carries the OAuth + PKCE params on the claude.ai authorize endpoint", () => {
    const url = new URL(buildAuthorizeUrl("challenge-x", "state-y"));
    expect(`${url.origin}${url.pathname}`).toBe("https://claude.ai/oauth/authorize");
    expect(Object.fromEntries(url.searchParams)).toEqual({
      code: "true",
      client_id: "9d1c250a-e61b-44d9-88ed-5944d1962f5e",
      response_type: "code",
      redirect_uri: "http://localhost:54545/callback",
      scope: "org:create_api_key user:profile user:inference",
      code_challenge: "challenge-x",
      code_challenge_method: "S256",
      state: "state-y",
    });
  });
});

describe("exchangeCode", () => {
  it("trades a code for a credential with the refresh skew baked in", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      json({ access_token: "at", refresh_token: "rt", expires_in: 3600 }),
    );
    const before = Date.now();
    const credential = await exchangeCode("code-1", "state-y", "verifier-x");
    expect(credential).toMatchObject({ accessToken: "at", refreshToken: "rt" });
    // 1h lifetime, 5min skew → ~55min out, never the raw hour.
    expect(credential.expiresAt).toBeGreaterThan(before + 54 * 60_000);
    expect(credential.expiresAt).toBeLessThan(before + 56 * 60_000);
  });

  it("reads the account name from the token response", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      json({
        access_token: "at",
        refresh_token: "rt",
        expires_in: 3600,
        account: { email_address: "Gus@Example.com" },
      }),
    );
    const credential = await exchangeCode("code-1", "s", "v");
    expect(credential.account).toBe("gus@example.com");
  });

  it("throws on an incomplete token response instead of a half-built credential", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(json({ access_token: "at" }));
    await expect(exchangeCode("c", "s", "v")).rejects.toThrow();
  });
});

describe("refreshCredential", () => {
  it("keeps the old refresh token when the response omits a new one", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      json({ access_token: "at-2", expires_in: 3600 }),
    );
    const next = await refreshCredential({
      accessToken: "at-1",
      refreshToken: "rt-1",
      expiresAt: 0,
    });
    expect(next).toMatchObject({ accessToken: "at-2", refreshToken: "rt-1" });
  });
});

describe("accountFromToken", () => {
  it("prefers the email, lowercased", () => {
    expect(accountFromToken(jwt({ email: "Gus@Example.COM", sub: "u1" }))).toBe("gus@example.com");
  });

  it("falls back to the sub claim when there is no email", () => {
    expect(accountFromToken(jwt({ sub: "s-7" }))).toBe("s-7");
  });

  it("returns undefined for anything that isn't a readable JWT", () => {
    // The row then just says "Signed in" — never a crash, never a raw token.
    expect(accountFromToken("not-a-jwt")).toBeUndefined();
    expect(accountFromToken("")).toBeUndefined();
  });
});
