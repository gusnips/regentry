import { describe, expect, it } from "vitest";
import { PRESETS, providerDisplayName, providerName } from "../presets";

describe("provider names", () => {
  it("qualifies only the products sold two ways", () => {
    // A plan and a key spend different quotas — the label has to say which.
    expect(providerDisplayName({ id: "claude", name: "" })).toBe("Claude (Subscription)");
    expect(providerDisplayName({ id: "anthropic", name: "" })).toBe("Anthropic (API key)");
    // One row, one way to pay, nothing to disambiguate.
    expect(providerDisplayName({ id: "deepseek", name: "" })).toBe("DeepSeek");
  });

  it("keeps the bare product name for surfaces that say the method themselves", () => {
    expect(providerName({ id: "claude", name: "" })).toBe("Claude");
    expect(providerName({ id: "anthropic", name: "" })).toBe("Anthropic");
  });

  it("falls back to the stored name for custom endpoints", () => {
    expect(providerDisplayName({ id: "custom-1", name: "My gateway" })).toBe("My gateway");
  });

  it("pairs presets in twos", () => {
    // A lone `paired` row would wear a qualifier answering a question nobody asked.
    const paired = PRESETS.filter((p) => p.paired);
    expect(paired.filter((p) => p.auth === "oauth")).toHaveLength(paired.length / 2);
  });

  it("keeps the subscription rows contiguous", () => {
    // The picker chunks PRESETS into sections by scanning runs, never sorting —
    // an OAuth row parked lower down would open a second Subscription heading.
    const oauth = PRESETS.map((p) => p.auth === "oauth");
    expect(oauth.lastIndexOf(true)).toBe(oauth.filter(Boolean).length - 1);
  });
});
