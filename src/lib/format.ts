/** "12s" / "3m 48s" — sub-second precision never matters on a run clock. */
/**
 * A duration in words, shortest unit first: 45s, 7m 58s, 2h 7m 58s, 3d 4h.
 * No "127m" — an hour-plus figure spelled in minutes is a number, not a read.
 * Days cap it: a run that crosses days is far past "how long did that take".
 */
export function formatDuration(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${s % 60}s`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ${m % 60}m ${s % 60}s`;
  return `${Math.floor(h / 24)}d ${h % 24}h`;
}

/** Host for tabs that never set a title — an empty stamp reads as a bug. */
export function hostnameOf(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}

export function formatTokens(n: number): string {
  return n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n);
}

/** Cap the TOTAL length including the ellipsis — for UI strings that must fit a row. */
export function truncateTo(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}
