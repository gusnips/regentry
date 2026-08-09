import { i18n, DEFAULT_LOCALE, SUPPORTED_LOCALES } from "@/i18n";

/**
 * When a rate-limited request can be retried, read from the response headers.
 * A 429's body never says whether the limit is a per-minute throttle or a
 * subscription window (Claude OAuth 5-hour / weekly) that resets in days — the
 * headers do. Without them the UI can only say "try again in a moment", which
 * is a lie for the multi-day case.
 */
export interface RateLimitReset {
  /** Absolute time the binding window resets, when any header disclosed it. */
  resetAtMs?: number;
  /** Server-requested wait (`retry-after`) — the retry policy honors it. */
  retryAfterMs?: number;
  /** Which subscription window bound — only Anthropic's unified headers say. */
  window?: "5h" | "weekly";
}

const RETRY_AFTER = "retry-after";
const UNIFIED_5H = "anthropic-ratelimit-unified-5h-";
const UNIFIED_7D = "anthropic-ratelimit-unified-7d-";

function seconds(value: string | null): number | undefined {
  if (!value) return undefined;
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n : undefined;
}

function unixSecondsToMs(value: string | null): number | undefined {
  const n = seconds(value);
  return n === undefined ? undefined : n * 1000;
}

/** `retry-after` is delay-seconds, but HTTP also allows an absolute date. */
function retryAfterMs(value: string | null, now: number): number | undefined {
  if (!value) return undefined;
  const n = Number(value);
  if (Number.isFinite(n) && n >= 0) return n * 1000;
  const at = Date.parse(value);
  return Number.isNaN(at) ? undefined : Math.max(0, at - now);
}

/**
 * Parse the rate-limit headers off a (usually 429) response. Anthropic's
 * `anthropic-ratelimit-unified-*` pair rides on every OAuth response: the
 * window with the higher utilization is the one a "would exceed your rate
 * limit" 429 is about. API-key accounts get the `anthropic-ratelimit-*-reset`
 * RFC 3339 timestamps instead. Everything is optional — an unrecognized shape
 * yields an empty result and the caller falls back to its generic message.
 */
export function parseRateLimitReset(
  get: (name: string) => string | null,
  now: number,
): RateLimitReset {
  const result: RateLimitReset = {};

  const after = retryAfterMs(get(RETRY_AFTER), now);
  if (after !== undefined) {
    result.retryAfterMs = after;
    result.resetAtMs = now + after;
  }

  const windows = [
    {
      window: "5h" as const,
      utilization: seconds(get(`${UNIFIED_5H}utilization`)),
      reset: unixSecondsToMs(get(`${UNIFIED_5H}reset`)),
    },
    {
      window: "weekly" as const,
      utilization: seconds(get(`${UNIFIED_7D}utilization`)),
      reset: unixSecondsToMs(get(`${UNIFIED_7D}reset`)),
    },
  ].filter((w) => w.utilization !== undefined && w.reset !== undefined && w.reset > now);
  const binding = windows.sort((a, b) => (b.utilization ?? 0) - (a.utilization ?? 0))[0];
  if (binding) {
    result.window = binding.window;
    // The window's own reset outranks retry-after: it names the real horizon.
    if (binding.reset !== undefined) result.resetAtMs = binding.reset;
  }

  if (result.resetAtMs === undefined) {
    for (const name of ["anthropic-ratelimit-requests-reset", "anthropic-ratelimit-tokens-reset"]) {
      const at = Date.parse(get(name) ?? "");
      if (!Number.isNaN(at) && at > now) {
        result.resetAtMs = at;
        break;
      }
    }
  }

  return result;
}

/**
 * "in 4 hours" / "em 3 dias" — relative time in the UI locale. Absolute "at
 * 6:47 PM" reads better for minutes, but locale-correct at/on/às glue for
 * mixed date+time is a translation trap; relative formats cleanly everywhere.
 */
export function formatResetRelative(resetAtMs: number, now: number): string {
  return formatRelative(Math.max(0, resetAtMs - now));
}

/** "2 minutes ago" / "há 2 minutos" — the past counterpart of formatResetRelative. */
export function formatAgo(atMs: number, now: number): string {
  return formatRelative(-Math.max(0, now - atMs));
}

function formatRelative(diffMs: number): string {
  const minutes = Math.abs(diffMs) / 60_000;
  const sign = Math.sign(diffMs) || 1;
  const [value, unit]: [number, Intl.RelativeTimeFormatUnit] =
    minutes < 90
      ? [Math.max(1, Math.round(minutes)), "minute"]
      : minutes < 36 * 60
        ? [Math.round(minutes / 60), "hour"]
        : [Math.round(minutes / (60 * 24)), "day"];
  const locale = SUPPORTED_LOCALES.find((l) => l === i18n.language) ?? DEFAULT_LOCALE;
  return new Intl.RelativeTimeFormat(locale, { numeric: "always" }).format(sign * value, unit);
}
