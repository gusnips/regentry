import type { OAuthCredential } from "./types";
import { captureRedirect, generatePKCE, jwtClaims, postToken, str, toCredential } from "./oauth";
import { createLogger } from "@/lib/logger";

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
 * authorize URL so it can offer a manual link if the tab never opened.
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

  const code = await captureRedirect({
    authorizeUrl,
    redirectUri: CLAUDE_OAUTH.redirectUri,
    state,
    signal,
  });
  return exchangeCode(code, state, verifier);
}

/** Trade the authorization code for a token pair. */
export async function exchangeCode(
  code: string,
  state: string,
  verifier: string,
): Promise<OAuthCredential> {
  const body = await postToken(
    CLAUDE_OAUTH.tokenUrl,
    {
      grant_type: "authorization_code",
      client_id: CLAUDE_OAUTH.clientId,
      code,
      state,
      redirect_uri: CLAUDE_OAUTH.redirectUri,
      code_verifier: verifier,
    },
    { encode: "json" },
  );
  return withAccount(body);
}

/** Trade a refresh token for a fresh pair. Anthropic rotates the access token; keep the old refresh when it omits one. */
export async function refreshCredential(credential: OAuthCredential): Promise<OAuthCredential> {
  const body = await postToken(
    CLAUDE_OAUTH.tokenUrl,
    {
      grant_type: "refresh_token",
      client_id: CLAUDE_OAUTH.clientId,
      refresh_token: credential.refreshToken,
    },
    { encode: "json" },
  );
  log.info("token refreshed");
  return withAccount(body, credential.refreshToken);
}

/** The credential a token response describes, named after the account it belongs to. */
function withAccount(body: Record<string, unknown>, fallbackRefresh?: string): OAuthCredential {
  const credential = toCredential(body, fallbackRefresh);
  const account = accountFromResponse(body) ?? accountFromToken(credential.accessToken);
  return account ? { ...credential, account } : credential;
}

/**
 * The account a token belongs to, for the UI to show. Anthropic names it in
 * the token response (`account.email_address`); this reads the JWT claims as a
 * fallback — email first, then the subject id.
 */
export function accountFromToken(token: string): string | undefined {
  const claims = jwtClaims(token);
  if (!claims) return undefined;
  return str(claims.email)?.toLowerCase() ?? str(claims.sub);
}

/** The account the token response itself names, if any. */
function accountFromResponse(body: Record<string, unknown>): string | undefined {
  const account = body.account;
  if (typeof account !== "object" || account === null) return undefined;
  const record = account as Record<string, unknown>;
  return str(record.email_address)?.toLowerCase() ?? str(record.uuid);
}
