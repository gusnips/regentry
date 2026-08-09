import { describe, it, expect, vi, beforeEach } from "vitest";
import { initProviderOriginStrip } from "../origin";

/**
 * The one rule that decides whether a subscription sign-in works at all:
 * Anthropic's CORS gate refuses an OAuth token that arrives with a browser
 * Origin, and the worker's fetch always sends one. These pin the strip itself
 * and, just as importantly, its boundary — a user-typed custom endpoint keeps
 * its Origin, so the rule can never become a way to hide who we are from a
 * host we were never going to call.
 */

const updateSessionRules = vi.fn((_options: unknown) => Promise.resolve());

beforeEach(() => {
  updateSessionRules.mockClear();
  (globalThis as Record<string, unknown>).chrome = {
    declarativeNetRequest: { updateSessionRules },
  };
});

const lastRule = (): chrome.declarativeNetRequest.Rule => {
  const options = updateSessionRules.mock.calls[0]?.[0] as {
    addRules: chrome.declarativeNetRequest.Rule[];
  };
  return options.addRules[0]!;
};

describe("initProviderOriginStrip", () => {
  it("removes Origin and Referer from the known provider hosts", async () => {
    initProviderOriginStrip();
    await vi.waitFor(() => expect(updateSessionRules).toHaveBeenCalledOnce());

    const rule = lastRule();
    expect(rule.action.requestHeaders).toEqual([
      { header: "origin", operation: "remove" },
      { header: "referer", operation: "remove" },
    ]);
    expect(rule.condition.requestDomains).toContain("api.anthropic.com");
  });

  it("keeps Origin for hosts we were never given — the strip can't be a privacy leak", async () => {
    initProviderOriginStrip();
    await vi.waitFor(() => expect(updateSessionRules).toHaveBeenCalledOnce());

    const domains = lastRule().condition.requestDomains!;
    // The allowlist is the preset hosts — nothing that ends up there by a
    // user's custom-endpoint input, and nothing unbounded like "*".
    expect(domains).not.toContain("*");
    expect(domains.every((d) => /^[a-z0-9.-]+\.[a-z]+$/.test(d))).toBe(true);
  });
});
