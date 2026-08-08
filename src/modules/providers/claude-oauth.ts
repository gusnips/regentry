import type { OAuthCredential } from "./types";
import { ProviderError, SignInError } from "./types";
import { createLogger } from "@/lib/logger";
import { i18n } from "@/i18n";

const log = createLogger("claude-oauth");

/**
 * Anthropic's Claude Code OAuth surface, all of it. The client id is the one
 * the CLI ships publicly and the redirect is the CLI's hardcoded localhost
 * callback — sign-in works without impersonating the CLI: we reuse its
 * registered client, run PKCE against Claude.ai ourselves, and capture the
 * redirect with tabs.onUpdated because an MV3 service worker can't listen on a
 * socket (and there is nothing to listen for — the code rides the URL).
 *
 * ponytail: a vendor's public client id and a fixed redirect port. Ceiling —
 * if Anthropic rotates the client or rejects the redirect, sign-in breaks;
 * this file is then the only thing to fix.
 */
const CLAUDE_OAUTH = {
  clientId: "9d1c250a-e61b-44d9-88ed-5944d1962f5e",
  authorizeUrl: "https://claude.ai/oauth/authorize",
  tokenUrl: "https://platform.claude.com/v1/oauth/token",
  redirectUri: "http://localhost:54545/callback",
  scopes: "org:create_api_key user:profile user:inference",
} as const;

const callbackUrl = new URL(CLAUDE_OAUTH.redirectUri);
const CALLBACK_ORIGIN = callbackUrl.origin;
const CALLBACK_PATH = callbackUrl.pathname;

/**
 * Refresh this long before the server's stated expiry. Baked into the stored
 * `expiresAt` so every reader gets the margin for free.
 */
const REFRESH_SKEW_MS = 5 * 60 * 1000;
/** An authorization code is only good for a few minutes — stop waiting past that. */
const CALLBACK_TIMEOUT_MS = 5 * 60 * 1000;

/** RFC 7636 code verifier + S256 challenge, browser-safe (no Node Buffer). */
export async function generatePKCE(): Promise<{ verifier: string; challenge: string }> {
  const verifierBytes = new Uint8Array(64);
  crypto.getRandomValues(verifierBytes);
  const verifier = toBase64Url(verifierBytes);
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  return { verifier, challenge: toBase64Url(new Uint8Array(digest)) };
}

/** The authorize URL to open — exported so tests can pin the exact params. */
export function buildAuthorizeUrl(challenge: string, state: string): string {
  const params = new URLSearchParams({
    code: "true", // tells the login page to show the subscription upsell
    client_id: CLAUDE_OAUTH.clientId,
    response_type: "code",
    redirect_uri: CLAUDE_OAUTH.redirectUri,
    scope: CLAUDE_OAUTH.scopes,
    code_challenge: challenge,
    code_challenge_method: "S256",
    state,
  });
  return `${CLAUDE_OAUTH.authorizeUrl}?${params.toString()}`;
}

/**
 * Full sign-in, start to finish: open the approval page, capture the localhost
 * redirect, exchange the code for tokens. `onPending` hands the UI the
 * authorize URL so it can offer a manual link if the tab never opened. The
 * authorize tab is closed on every exit — success, failure, or cancel.
 */
export async function signInWithClaude(
  signal: AbortSignal,
  onPending?: (authorizeUrl: string) => void,
): Promise<OAuthCredential> {
  const { verifier, challenge } = await generatePKCE();
  // Anthropic quirk: claude.ai/oauth/authorize rejects a random `state` with
  // "Invalid request format" — the state must be the PKCE verifier, which is
  // what the Claude Code CLI ships. Same secret the exchange needs, so a
  // forged callback still can't mint tokens.
  const state = verifier;
  const authorizeUrl = buildAuthorizeUrl(challenge, state);
  onPending?.(authorizeUrl);

  const code = await waitForCallback(state, authorizeUrl, signal);
  return exchangeCode(code, state, verifier);
}

/**
 * Wait for the browser to redirect the authorize tab to our localhost
 * callback, then read the code off the URL. There's no server behind that
 * port — the tab is about to show a connection error — so the code is grabbed
 * the moment the navigation starts and the tab is closed before that page
 * renders.
 */
function waitForCallback(
  state: string,
  authorizeUrl: string,
  signal: AbortSignal,
): Promise<string> {
  return new Promise((resolve, reject) => {
    let openedTabId: number | undefined;
    let settled = false;

    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      cleanup();
      fn();
    };

    const cleanup = () => {
      signal.removeEventListener("abort", onAbort);
      clearTimeout(timeout);
      chrome.tabs.onUpdated.removeListener(onUpdated);
      chrome.tabs.onRemoved.removeListener(onRemoved);
      if (openedTabId !== undefined) void chrome.tabs.remove(openedTabId);
    };

    const onAbort = () => finish(() => reject(new SignInError("cancelled")));
    signal.addEventListener("abort", onAbort, { once: true });

    const timeout = setTimeout(
      () => finish(() => reject(new SignInError("expired"))),
      CALLBACK_TIMEOUT_MS,
    );

    // The installed @types/chrome is a partial stub without TabChangeInfo —
    // derive the listener signature from the API it attaches to instead.
    const onUpdated: Parameters<typeof chrome.tabs.onUpdated.addListener>[0] = (
      tabId,
      changeInfo,
    ) => {
      if (tabId !== openedTabId || !changeInfo.url) return;
      // The approval page bounces claude.ai → consent → localhost callback;
      // only the final hop onto our redirect matters.
      if (!changeInfo.url.startsWith(CALLBACK_ORIGIN) || !CALLBACK_PATH) return;
      const url = new URL(changeInfo.url);
      if (url.pathname !== CALLBACK_PATH) return;

      // CSRF guard: the callback must carry the state we issued.
      if (url.searchParams.get("state") !== state || url.searchParams.get("error")) {
        finish(() => reject(new SignInError("denied")));
        return;
      }
      const code = url.searchParams.get("code");
      if (!code) {
        finish(() => reject(new SignInError("denied")));
        return;
      }
      finish(() => resolve(code));
    };

    // The user closing the approve tab is a cancel, not a five-minute wait.
    const onRemoved: Parameters<typeof chrome.tabs.onRemoved.addListener>[0] = (tabId) => {
      if (tabId === openedTabId) finish(() => reject(new SignInError("cancelled")));
    };

    chrome.tabs.onUpdated.addListener(onUpdated);
    chrome.tabs.onRemoved.addListener(onRemoved);

    void chrome.tabs.create({ url: authorizeUrl }).then(
      (tab) => {
        if (settled) {
          // The tab created is ours, so its id is set — but the type keeps it
          // optional, and removing an id-less tab would be a no-op anyway.
          if (tab.id) void chrome.tabs.remove(tab.id);
          return;
        }
        openedTabId = tab.id;
      },
      (err: unknown) => finish(() => reject(err instanceof Error ? err : new Error(String(err)))),
    );
  });
}

/** Trade the authorization code for a token pair. */
export async function exchangeCode(
  code: string,
  state: string,
  verifier: string,
): Promise<OAuthCredential> {
  const body = await postJson(CLAUDE_OAUTH.tokenUrl, {
    grant_type: "authorization_code",
    client_id: CLAUDE_OAUTH.clientId,
    code,
    state,
    redirect_uri: CLAUDE_OAUTH.redirectUri,
    code_verifier: verifier,
  });
  return toCredential(body);
}

/** Trade a refresh token for a fresh pair. Anthropic rotates the access token; keep the old refresh when it omits one. */
export async function refreshCredential(credential: OAuthCredential): Promise<OAuthCredential> {
  const body = await postJson(CLAUDE_OAUTH.tokenUrl, {
    grant_type: "refresh_token",
    client_id: CLAUDE_OAUTH.clientId,
    refresh_token: credential.refreshToken,
  });
  log.info("token refreshed");
  return toCredential(body, credential.refreshToken);
}

/**
 * The account a token belongs to, for the UI to show. Anthropic names it in
 * the token response (`account.email_address`); this reads the JWT payload as
 * a fallback WITHOUT verifying the signature, which is fine because nothing is
 * authorized on it — it only decides what name to print.
 */
export function accountFromToken(token: string): string | undefined {
  const payload = token.split(".")[1];
  if (!payload) return undefined;
  try {
    const json: unknown = JSON.parse(atob(payload.replace(/-/g, "+").replace(/_/g, "/")));
    if (typeof json !== "object" || json === null) return undefined;
    const claims = json as Record<string, unknown>;
    const email = str(claims.email);
    return email?.toLowerCase() ?? str(claims.sub);
  } catch {
    // Not a JWT, or not one we understand — the row just says "Signed in".
    return undefined;
  }
}

function toCredential(body: Record<string, unknown>, fallbackRefresh?: string): OAuthCredential {
  const accessToken = str(body.access_token);
  const refreshToken = str(body.refresh_token) ?? fallbackRefresh;
  const expiresIn = num(body.expires_in);
  if (!accessToken || !refreshToken || expiresIn === undefined) {
    throw new ProviderError(i18n.t("errors.claudeTokenResponse"), 0);
  }
  const account = accountFromResponse(body) ?? accountFromToken(accessToken);
  return {
    accessToken,
    refreshToken,
    // Skew baked in — readers compare against now() with no margin of their own.
    expiresAt: Date.now() + expiresIn * 1000 - REFRESH_SKEW_MS,
    ...(account ? { account } : {}),
  };
}

/** The account the token response itself names, if any. */
function accountFromResponse(body: Record<string, unknown>): string | undefined {
  const account = body.account;
  if (typeof account !== "object" || account === null) return undefined;
  const record = account as Record<string, unknown>;
  const email = str(record.email_address);
  return email?.toLowerCase() ?? str(record.uuid);
}

function toBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function postJson(
  url: string,
  params: Record<string, string>,
): Promise<Record<string, unknown>> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify(params),
  });

  const body: unknown = await res.json().catch(() => null);
  const record = typeof body === "object" && body !== null ? (body as Record<string, unknown>) : {};

  if (!res.ok) {
    // A 429 at the token exchange means the account authenticated but the plan
    // is over its usage limit (5h rolling / weekly) — not a failed sign-in, so
    // it gets its own message instead of a bare "sign-in failed: 429".
    if (res.status === 429) {
      throw new ProviderError(i18n.t("errors.signInRateLimited"), res.status);
    }
    throw new ProviderError(
      i18n.t("errors.claudeSignInFailed", {
        detail: oauthErrorDetail(record) ?? String(res.status),
      }),
      res.status,
    );
  }
  return record;
}

/**
 * Pull a human reason out of an OAuth error body — RFC 6749 (`error` /
 * `error_description`) or a nested object (`error.message` / `error.type`),
 * which Anthropic and OpenAI both use.
 */
function oauthErrorDetail(record: Record<string, unknown>): string | undefined {
  const description = str(record.error_description);
  if (description) return description;
  const error = record.error;
  if (typeof error === "string") return error;
  if (typeof error === "object" && error !== null) {
    const nested = error as Record<string, unknown>;
    return str(nested.message) ?? str(nested.type);
  }
  return undefined;
}

const str = (v: unknown): string | undefined =>
  typeof v === "string" && v.length > 0 ? v : undefined;

const num = (v: unknown): number | undefined =>
  typeof v === "number" && Number.isFinite(v) ? v : undefined;
