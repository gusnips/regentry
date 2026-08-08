import type { OAuthCredential } from "./types";
import { ProviderError, SignInError } from "./types";
import { createLogger } from "@/lib/logger";
import { i18n } from "@/i18n";

const log = createLogger("chatgpt-oauth");

/**
 * OpenAI's ChatGPT Codex OAuth surface, all of it. The client id is the one
 * the Codex CLI ships publicly and the redirect is its hardcoded localhost
 * callback — sign-in works without impersonating the CLI: we reuse its
 * registered client, run PKCE against auth.openai.com ourselves, and capture
 * the redirect with tabs.onUpdated because an MV3 service worker can't listen
 * on a socket (and there is nothing to listen for — the code rides the URL).
 * The scope's `api.connectors.*` grants are what unlock the subscription quota
 * the Codex backend bills against.
 *
 * ponytail: a vendor's public client id and a fixed redirect port. Ceiling —
 * if OpenAI rotates the client or rejects the redirect, sign-in breaks; this
 * file is then the only thing to fix.
 */
const CHATGPT_OAUTH = {
  clientId: "app_EMoamEEZ73f0CkXaXp7hrann",
  authorizeUrl: "https://auth.openai.com/oauth/authorize",
  tokenUrl: "https://auth.openai.com/oauth/token",
  redirectUri: "http://localhost:1455/auth/callback",
  scopes:
    "openid profile email offline_access api.connectors.read api.connectors.invoke",
} as const;

const callbackUrl = new URL(CHATGPT_OAUTH.redirectUri);
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
    response_type: "code",
    client_id: CHATGPT_OAUTH.clientId,
    redirect_uri: CHATGPT_OAUTH.redirectUri,
    scope: CHATGPT_OAUTH.scopes,
    code_challenge: challenge,
    code_challenge_method: "S256",
    state,
    // The Codex CLI's own params — simplified flow hides the raw consent page
    // behind the subscription upsell, and the originator labels the app that
    // the tokens are being minted for.
    codex_cli_simplified_flow: "true",
    originator: "opencodex",
    id_token_add_organizations: "true",
  });
  return `${CHATGPT_OAUTH.authorizeUrl}?${params.toString()}`;
}

/**
 * Full sign-in, start to finish: open the approval page, capture the localhost
 * redirect, exchange the code for tokens. `onPending` hands the UI the
 * authorize URL so it can offer a manual link if the tab never opened. The
 * authorize tab is closed on every exit — success, failure, or cancel.
 */
export async function signInWithChatGPT(
  signal: AbortSignal,
  onPending?: (authorizeUrl: string) => void,
): Promise<OAuthCredential> {
  const { verifier, challenge } = await generatePKCE();
  const state = generateState();
  const authorizeUrl = buildAuthorizeUrl(challenge, state);
  onPending?.(authorizeUrl);

  const code = await waitForCallback(state, authorizeUrl, signal);
  return exchangeCode(code, verifier);
}

/**
 * Wait for the browser to redirect the authorize tab to our localhost
 * callback, then read the code off the URL. There's no server behind that
 * port — the tab is about to show a connection error — so the code is grabbed
 * the moment the navigation starts and the tab is closed before that page
 * renders.
 */
function waitForCallback(state: string, authorizeUrl: string, signal: AbortSignal): Promise<string> {
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
      // The approval page bounces auth.openai.com → consent → localhost
      // callback; only the final hop onto our redirect matters.
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
      (err: unknown) =>
        finish(() => reject(err instanceof Error ? err : new Error(String(err)))),
    );
  });
}

/** Trade the authorization code for a token pair (form-urlencoded, per auth.openai.com). */
export async function exchangeCode(code: string, verifier: string): Promise<OAuthCredential> {
  const body = await postForm(CHATGPT_OAUTH.tokenUrl, {
    grant_type: "authorization_code",
    client_id: CHATGPT_OAUTH.clientId,
    code,
    redirect_uri: CHATGPT_OAUTH.redirectUri,
    code_verifier: verifier,
  });
  return toCredential(body);
}

/**
 * Trade a refresh token for a fresh pair. Both tokens rotate — persist both.
 * The new access token carries the same account claims, so the account id is
 * re-extracted; kept from the old credential as a fallback in case the refresh
 * response omits the id_token.
 */
export async function refreshCredential(credential: OAuthCredential): Promise<OAuthCredential> {
  const body = await postForm(CHATGPT_OAUTH.tokenUrl, {
    grant_type: "refresh_token",
    client_id: CHATGPT_OAUTH.clientId,
    refresh_token: credential.refreshToken,
  });
  log.info("token refreshed");
  return toCredential(body, credential.refreshToken, credential.chatgptAccountId);
}

/** Read a JWT payload WITHOUT verifying the signature — fine, nothing is authorized on it. */
function decodeJwtPayload(token: string): Record<string, unknown> | undefined {
  const payload = token.split(".")[1];
  if (!payload) return undefined;
  try {
    const json: unknown = JSON.parse(atob(payload.replace(/-/g, "+").replace(/_/g, "/")));
    return typeof json === "object" && json !== null ? (json as Record<string, unknown>) : undefined;
  } catch {
    // Not a JWT, or not one we understand — the account just says "Signed in".
    return undefined;
  }
}

/**
 * The ChatGPT account id a token belongs to — the `ChatGPT-Account-Id` header
 * the Codex backend requires. OpenAI names it `chatgpt_account_id` on the
 * token, nested under `https://api.openai.com/auth` on some token kinds, and
 * `organizations[0].id` on others — check all three.
 */
export function chatgptAccountIdFromToken(token?: string): string | undefined {
  if (!token) return undefined;
  const claims = decodeJwtPayload(token);
  if (!claims) return undefined;

  const direct = str(claims.chatgpt_account_id);
  if (direct) return direct;

  const ns = claims["https://api.openai.com/auth"];
  if (typeof ns === "object" && ns !== null) {
    const nested = str((ns as Record<string, unknown>).chatgpt_account_id);
    if (nested) return nested;
  }

  const orgs = claims.organizations;
  if (Array.isArray(orgs)) {
    const first = orgs[0];
    if (typeof first === "object" && first !== null) {
      const id = str((first as Record<string, unknown>).id);
      if (id) return id;
    }
  }
  return undefined;
}

/**
 * The account a token belongs to, for the UI to show. ChatGPT JWTs carry the
 * email directly — reads it without verifying the signature, because nothing
 * is authorized on it — it only decides what name to print.
 */
export function accountFromToken(token?: string): string | undefined {
  if (!token) return undefined;
  const claims = decodeJwtPayload(token);
  if (!claims) return undefined;
  return str(claims.email)?.toLowerCase();
}

function toCredential(
  body: Record<string, unknown>,
  fallbackRefresh?: string,
  fallbackAccountId?: string,
): OAuthCredential {
  const accessToken = str(body.access_token);
  const refreshToken = str(body.refresh_token) ?? fallbackRefresh;
  const expiresIn = num(body.expires_in);
  if (!accessToken || !refreshToken || expiresIn === undefined) {
    throw new ProviderError(i18n.t("errors.chatgptTokenResponse"), 0);
  }
  // The id_token is the richer claim set; the access token covers refresh
  // responses that omit it.
  const idToken = str(body.id_token);
  const account = accountFromToken(idToken) ?? accountFromToken(accessToken);
  const chatgptAccountId =
    chatgptAccountIdFromToken(idToken) ?? chatgptAccountIdFromToken(accessToken) ?? fallbackAccountId;
  return {
    accessToken,
    refreshToken,
    // Skew baked in — readers compare against now() with no margin of their own.
    expiresAt: Date.now() + expiresIn * 1000 - REFRESH_SKEW_MS,
    ...(account ? { account } : {}),
    ...(chatgptAccountId ? { chatgptAccountId } : {}),
  };
}

function generateState(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return toBase64Url(bytes);
}

function toBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function postForm(
  url: string,
  params: Record<string, string>,
): Promise<Record<string, unknown>> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
    body: new URLSearchParams(params).toString(),
  });

  const body: unknown = await res.json().catch(() => null);
  const record = typeof body === "object" && body !== null ? (body as Record<string, unknown>) : {};

  // A vendor can hand back a usable credential on a non-200 — if the body
  // carries real tokens, the sign-in succeeded; only fall through to error
  // handling when it doesn't.
  if (isCredentialBody(record)) return record;

  if (!res.ok) {
    // A 429 with no token means the account authenticated but the plan is over
    // its usage limit — not a failed sign-in, so it gets its own message
    // instead of a bare "sign-in failed: 429".
    if (res.status === 429) {
      throw new ProviderError(i18n.t("errors.signInRateLimited"), res.status);
    }
    throw new ProviderError(
      i18n.t("errors.chatgptSignInFailed", {
        detail: oauthErrorDetail(record) ?? String(res.status),
      }),
      res.status,
    );
  }
  return record;
}

/** Whether the body holds a full token pair — the sign of a successful exchange. */
function isCredentialBody(body: Record<string, unknown>): boolean {
  return (
    typeof body.access_token === "string" &&
    body.access_token.length > 0 &&
    typeof body.refresh_token === "string" &&
    body.refresh_token.length > 0 &&
    typeof body.expires_in === "number" &&
    Number.isFinite(body.expires_in)
  );
}

/**
 * Pull a human reason out of an OAuth error body — RFC 6749 (`error` /
 * `error_description`) or a nested object (`error.message` / `error.type`).
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
