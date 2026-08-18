/**
 * Host scoping for the memory docs: a `## site: <host>` section loads only when
 * the run starts on that site. Pure string logic, no storage.
 *
 * Deliberately not `lib/format.ts#hostnameOf` — that helper's junk-in/junk-out
 * contract is right for display labels and wrong here, where an unparseable
 * host must become null (= global) instead of a section nothing ever matches.
 */

/** A bare IP literal — suffix matching across its "labels" would be meaningless. */
function isIpLiteral(host: string): boolean {
  return /^\d{1,3}(\.\d{1,3}){3}$/.test(host) || host.includes(":");
}

/**
 * Canonical form of a host named by the model or a doc header: lowercase, no
 * `www.`, no port, no trailing dot. Accepts full URLs too — models send them
 * no matter what the schema says. Null means nothing scopeable was named.
 */
export function normalizeHost(input: string): string | null {
  let host = input.trim();
  if (host.includes("://") || host.includes("/")) {
    try {
      host = new URL(host).hostname;
    } catch {
      return null;
    }
  }
  host = host.toLowerCase();
  const bracketed = /^\[([^\]]+)\](?::\d+)?$/.exec(host);
  if (bracketed?.[1]) host = bracketed[1];
  // A lone colon is a port; more than one is an IPv6 literal, left intact.
  else if ((host.match(/:/g) ?? []).length === 1) host = host.replace(/:\d+$/, "");
  host = host.replace(/^www\./, "").replace(/\.+$/, "");
  if (!host || /[\s/@#?]/.test(host)) return null;
  return host;
}

/**
 * The host a run's start URL scopes to. Only web pages have a site — anything
 * else (chrome://, about:, file:, missing) is null, a global-only load. The
 * protocol check is load-bearing: `new URL("chrome://extensions").hostname`
 * is the junk string "extensions".
 */
export function scopeHostOf(url: string | undefined): string | null {
  if (!url) return null;
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
    return normalizeHost(parsed.hostname);
  } catch {
    return null;
  }
}

/**
 * Does a `## site:` section apply to a tab? Both hosts pre-normalized. Suffix
 * match, so `google.com` covers `mail.google.com`; the dot prefix keeps
 * `notgoogle.com` out, and IP literals only ever match themselves.
 */
export function hostMatches(sectionHost: string, tabHost: string): boolean {
  if (sectionHost === tabHost) return true;
  if (isIpLiteral(sectionHost) || isIpLiteral(tabHost)) return false;
  return tabHost.endsWith(`.${sectionHost}`);
}
