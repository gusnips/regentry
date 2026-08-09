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
  window?: "5h" | "weekly" | "monthly";
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
 * ChatGPT's codex backend puts the reset IN THE 429 BODY, not the headers:
 * `{"error":{"type":"usage_limit_reached","resets_at":1788801754,"resets_in_seconds":2501465}}`.
 * The window name is inferred from the wait itself — but only past ten minutes:
 * a sub-minute retry is a per-minute throttle, and calling it a "5-hour window"
 * would be its own lie.
 */
export function parseUsageLimitBody(bodyText: string, now: number): RateLimitReset {
  let body: unknown;
  try {
    body = JSON.parse(bodyText);
  } catch {
    return {};
  }
  if (typeof body !== "object" || body === null) return {};
  const source = (body as Record<string, unknown>).error;
  const error =
    typeof source === "object" && source !== null
      ? (source as Record<string, unknown>)
      : (body as Record<string, unknown>);

  const inSeconds = Number(error.resets_in_seconds);
  const atSeconds = Number(error.resets_at);
  const retryAfterMs =
    Number.isFinite(inSeconds) && inSeconds >= 0
      ? inSeconds * 1000
      : Number.isFinite(atSeconds) && atSeconds > 0
        ? Math.max(0, atSeconds * 1000 - now)
        : undefined;
  if (retryAfterMs === undefined) return {};

  const result: RateLimitReset = { retryAfterMs, resetAtMs: now + retryAfterMs };
  if (retryAfterMs > 10 * 60_000) {
    result.window =
      retryAfterMs <= 5.5 * 3_600_000
        ? "5h"
        : retryAfterMs <= 7.5 * 86_400_000
          ? "weekly"
          : "monthly";
  }
  return result;
}

/**
 * "in 4 hours (6:47 PM)" / "em 3 dias (12 de ago., 14:30)" — relative time in
 * the UI locale, with the absolute time appended once the wait is long enough
 * that "when exactly" matters. Relative leads because locale-correct at/on/às
 * glue is a translation trap; the parenthesized absolute needs no glue.
 */
export function formatResetRelative(resetAtMs: number, now: number): string {
  const relative = formatRelative(Math.max(0, resetAtMs - now));
  if (resetAtMs - now < 90 * 60_000) return relative;
  return `${relative} (${formatAbsolute(resetAtMs, now)})`;
}

function formatAbsolute(resetAtMs: number, now: number): string {
  const locale = SUPPORTED_LOCALES.find((l) => l === i18n.language) ?? DEFAULT_LOCALE;
  const sameDay = new Date(resetAtMs).toDateString() === new Date(now).toDateString();
  const options: Intl.DateTimeFormatOptions = sameDay
    ? { hour: "numeric", minute: "2-digit" }
    : { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" };
  return new Intl.DateTimeFormat(locale, options).format(resetAtMs);
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
