import type { OAuthCredential } from "./types";
import { ProviderError } from "./types";
import { createLogger } from "@/lib/logger";
import { i18n } from "@/i18n";

const log = createLogger("kimi-oauth");

/**
 * Kimi's OAuth surface, all of it. The client id is the one Kimi's own CLI
 * ships publicly; sign-in works without impersonating it (the CLI's X-Msh-*
 * identity headers are optional — verified against the live endpoint), so we
 * send none of them and authenticate as ourselves.
 *
 * ponytail: a vendor's public client id. Ceiling — if Kimi rotates it or adds
 * client attestation, sign-in breaks; this file is then the only thing to fix.
 */
const KIMI_OAUTH = {
  clientId: "17e5f671-d194-4dfb-9706-5516cb48c098",
  deviceUrl: "https://auth.kimi.com/api/oauth/device_authorization",
  tokenUrl: "https://auth.kimi.com/api/oauth/token",
  deviceGrant: "urn:ietf:params:oauth:grant-type:device_code",
} as const;

/**
 * Refresh this long before the server's stated expiry. Baked into the stored
 * `expiresAt` so every reader gets the margin for free.
 */
const REFRESH_SKEW_MS = 5 * 60 * 1000;
/** RFC 8628: a `slow_down` response adds this to the poll interval. */
const SLOW_DOWN_STEP_MS = 5000;

/** What the user must do to finish signing in. */
export interface DevicePrompt {
  /** Shown verbatim — it must match what the page displays. */
  userCode: string;
  /** The approval page, user code pre-filled. */
  verificationUrl: string;
  deviceCode: string;
  intervalMs: number;
  expiresAt: number;
}

/** Why a sign-in ended without a credential — each wording is a different fix. */
export type SignInFailure = "expired" | "denied" | "cancelled";

export class SignInError extends Error {
  constructor(public readonly reason: SignInFailure) {
    super(reason);
    this.name = "SignInError";
  }
}

/** Step 1 — ask Kimi for a code the user can approve on the web. */
export async function requestDeviceCode(): Promise<DevicePrompt> {
  const body = await postForm(KIMI_OAUTH.deviceUrl, { client_id: KIMI_OAUTH.clientId });
  const userCode = str(body.user_code);
  const deviceCode = str(body.device_code);
  const verificationUrl = str(body.verification_uri_complete) ?? str(body.verification_uri);
  if (!userCode || !deviceCode || !verificationUrl) {
    throw new ProviderError(i18n.t("errors.kimiDeviceResponse"), 0);
  }
  const intervalSec = num(body.interval) ?? 5;
  const expiresSec = num(body.expires_in) ?? 900;
  log.info("device code issued", { expiresInSec: expiresSec });
  return {
    userCode,
    verificationUrl,
    deviceCode,
    intervalMs: Math.max(1000, intervalSec * 1000),
    expiresAt: Date.now() + expiresSec * 1000,
  };
}

/**
 * Step 2 — poll until the user approves. Resolves with the credential, or
 * throws SignInError so the caller can word each ending differently. The
 * signal is how a closed dialog stops the polling.
 */
export async function pollForToken(
  prompt: DevicePrompt,
  signal: AbortSignal,
): Promise<OAuthCredential> {
  let waitMs = prompt.intervalMs;
  while (Date.now() < prompt.expiresAt) {
    await sleep(waitMs, signal);
    const body = await postForm(
      KIMI_OAUTH.tokenUrl,
      {
        client_id: KIMI_OAUTH.clientId,
        device_code: prompt.deviceCode,
        grant_type: KIMI_OAUTH.deviceGrant,
      },
      // Pending is the expected answer for most of this loop, not a failure.
      { allowErrorBody: true },
    );

    if (str(body.access_token)) return toCredential(body);

    switch (str(body.error)) {
      case "authorization_pending":
        break;
      case "slow_down":
        // The server may also hand back a longer interval — honour whichever is larger.
        waitMs = Math.max(waitMs + SLOW_DOWN_STEP_MS, (num(body.interval) ?? 0) * 1000);
        break;
      case "access_denied":
        throw new SignInError("denied");
      case "expired_token":
        throw new SignInError("expired");
      default:
        throw new ProviderError(
          i18n.t("errors.kimiSignInFailed", {
            detail: str(body.error_description) ?? str(body.error) ?? "",
          }),
          0,
        );
    }
  }
  throw new SignInError("expired");
}

/** Trade a refresh token for a fresh pair. Both tokens rotate — persist both. */
export async function refreshCredential(credential: OAuthCredential): Promise<OAuthCredential> {
  const body = await postForm(KIMI_OAUTH.tokenUrl, {
    client_id: KIMI_OAUTH.clientId,
    grant_type: "refresh_token",
    refresh_token: credential.refreshToken,
  });
  log.info("token refreshed");
  // A refresh response may omit the refresh token; keeping the old one is correct then.
  return toCredential(body, credential.refreshToken);
}

/**
 * The account a token belongs to, for the UI to show. Kimi issues JWTs; this
 * reads the payload WITHOUT verifying the signature, which is fine because
 * nothing is authorized on it — it only decides what name to print.
 */
export function accountFromToken(token: string): string | undefined {
  const payload = token.split(".")[1];
  if (!payload) return undefined;
  try {
    const json: unknown = JSON.parse(atob(payload.replace(/-/g, "+").replace(/_/g, "/")));
    if (typeof json !== "object" || json === null) return undefined;
    const claims = json as Record<string, unknown>;
    const email = str(claims.email);
    return email?.toLowerCase() ?? str(claims.user_id) ?? str(claims.sub);
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
    throw new ProviderError(i18n.t("errors.kimiTokenResponse"), 0);
  }
  return {
    accessToken,
    refreshToken,
    // Skew baked in — readers compare against now() with no margin of their own.
    expiresAt: Date.now() + expiresIn * 1000 - REFRESH_SKEW_MS,
    ...(accountFromToken(accessToken) ? { account: accountFromToken(accessToken) } : {}),
  };
}

async function postForm(
  url: string,
  params: Record<string, string>,
  opts?: { allowErrorBody?: boolean },
): Promise<Record<string, unknown>> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
    body: new URLSearchParams(params).toString(),
  });

  const body: unknown = await res.json().catch(() => null);
  const record = typeof body === "object" && body !== null ? (body as Record<string, unknown>) : {};

  // The device-flow poll answers 4xx while the user is still deciding, so the
  // caller reads those bodies instead of treating them as transport failures.
  if (!res.ok && !(opts?.allowErrorBody && res.status < 500)) {
    throw new ProviderError(
      i18n.t("errors.kimiSignInFailed", {
        detail: str(record.error_description) ?? str(record.error) ?? String(res.status),
      }),
      res.status,
    );
  }
  return record;
}

/** Interruptible delay — a cancelled sign-in stops here, not one poll later. */
function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) return reject(new SignInError("cancelled"));
    const timer = setTimeout(resolve, ms);
    signal.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        reject(new SignInError("cancelled"));
      },
      { once: true },
    );
  });
}

const str = (v: unknown): string | undefined =>
  typeof v === "string" && v.length > 0 ? v : undefined;

const num = (v: unknown): number | undefined =>
  typeof v === "number" && Number.isFinite(v) ? v : undefined;
