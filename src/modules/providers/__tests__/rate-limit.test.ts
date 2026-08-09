import { describe, it, expect } from "vitest";
import { parseRateLimitReset, formatResetRelative } from "../rate-limit";

const NOW = Date.parse("2026-08-09T12:00:00Z");

function headers(map: Record<string, string>): (name: string) => string | null {
  return (name) => map[name] ?? null;
}

describe("parseRateLimitReset", () => {
  it("reads retry-after as delay-seconds", () => {
    expect(parseRateLimitReset(headers({ "retry-after": "30" }), NOW)).toEqual({
      retryAfterMs: 30_000,
      resetAtMs: NOW + 30_000,
    });
  });

  it("reads retry-after as an HTTP-date", () => {
    const result = parseRateLimitReset(
      headers({ "retry-after": "Sun, 09 Aug 2026 12:05:00 GMT" }),
      NOW,
    );
    expect(result.retryAfterMs).toBe(300_000);
    expect(result.resetAtMs).toBe(NOW + 300_000);
  });

  it("names the 5-hour window when its utilization binds", () => {
    const reset = NOW / 1000 + 2 * 3600;
    const result = parseRateLimitReset(
      headers({
        "retry-after": "7200",
        "anthropic-ratelimit-unified-5h-utilization": "1",
        "anthropic-ratelimit-unified-5h-reset": String(reset),
        "anthropic-ratelimit-unified-7d-utilization": "0.4",
        "anthropic-ratelimit-unified-7d-reset": String(reset + 3 * 86400),
      }),
      NOW,
    );
    expect(result.window).toBe("5h");
    expect(result.resetAtMs).toBe(reset * 1000);
    expect(result.retryAfterMs).toBe(7_200_000);
  });

  it("names the weekly window when it is the exhausted one", () => {
    const reset = NOW / 1000 + 3 * 86400;
    const result = parseRateLimitReset(
      headers({
        "anthropic-ratelimit-unified-5h-utilization": "0.2",
        "anthropic-ratelimit-unified-5h-reset": String(NOW / 1000 + 3600),
        "anthropic-ratelimit-unified-7d-utilization": "1",
        "anthropic-ratelimit-unified-7d-reset": String(reset),
      }),
      NOW,
    );
    expect(result.window).toBe("weekly");
    expect(result.resetAtMs).toBe(reset * 1000);
  });

  it("falls back to the API-key RFC 3339 reset headers", () => {
    const result = parseRateLimitReset(
      headers({ "anthropic-ratelimit-requests-reset": "2026-08-09T12:01:00Z" }),
      NOW,
    );
    expect(result.window).toBeUndefined();
    expect(result.resetAtMs).toBe(Date.parse("2026-08-09T12:01:00Z"));
  });

  it("ignores garbage and windows already past", () => {
    expect(parseRateLimitReset(headers({ "retry-after": "soon" }), NOW)).toEqual({});
    expect(
      parseRateLimitReset(
        headers({
          "anthropic-ratelimit-unified-5h-utilization": "1",
          "anthropic-ratelimit-unified-5h-reset": String(NOW / 1000 - 60),
        }),
        NOW,
      ),
    ).toEqual({});
    expect(parseRateLimitReset(headers({}), NOW)).toEqual({});
  });
});

describe("formatResetRelative", () => {
  it("picks the largest readable unit", () => {
    expect(formatResetRelative(NOW + 5 * 60_000, NOW)).toBe("in 5 minutes");
    expect(formatResetRelative(NOW + 4 * 3_600_000, NOW)).toBe("in 4 hours");
    expect(formatResetRelative(NOW + 3 * 86_400_000, NOW)).toBe("in 3 days");
  });

  it("never says zero for a sub-minute wait", () => {
    expect(formatResetRelative(NOW + 10_000, NOW)).toBe("in 1 minute");
  });
});
