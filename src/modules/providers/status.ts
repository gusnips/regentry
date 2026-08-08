import type { ProviderConfig } from "./types";
import { PRESETS } from "./presets";

/**
 * Whether a provider can actually run a task. The list sorts and labels on
 * this, so "which of these works?" is answerable by scanning rather than by
 * opening each one.
 *
 * Deliberately two states, not three: a token past its expiry is NOT a
 * problem — the next run refreshes it silently — so surfacing "expired" for
 * that would alarm the user about the normal case. A refresh that fails for
 * good clears the credential (see credential.ts), which lands the row in
 * `missing` with a Sign in button — the one action that actually helps.
 */
export type CredentialStatus = "connected" | "missing";

/** Local endpoints (Ollama) need no credential — they are usable as they are. */
function needsNoCredential(baseUrl: string): boolean {
  try {
    const { hostname } = new URL(baseUrl);
    return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]";
  } catch {
    return false;
  }
}

/** Whether this provider signs in rather than holding a pasted key. */
export function isOAuthProvider(id: string): boolean {
  return PRESETS.find((p) => p.id === id)?.auth === "oauth";
}

export function credentialStatus(provider: ProviderConfig): CredentialStatus {
  if (isOAuthProvider(provider.id)) return provider.auth ? "connected" : "missing";
  return provider.apiKey || needsNoCredential(provider.baseUrl) ? "connected" : "missing";
}

/** Connected first, unconfigured last; original order kept within each group. */
export function byCredentialStatus(a: ProviderConfig, b: ProviderConfig): number {
  const rank = (p: ProviderConfig) => (credentialStatus(p) === "connected" ? 0 : 1);
  return rank(a) - rank(b);
}
