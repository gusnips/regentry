import { ProviderError } from "./types";
import { classifyProviderError, type ErrorKind } from "./error-classify";
import { createLogger, truncate } from "@/lib/logger";
import { i18n } from "@/i18n";

const log = createLogger("providers");

/** Actionable lead line per failure kind — the raw body still rides along for Details. */
const ERROR_KIND_KEYS = {
  entitlement: "errors.kindEntitlement",
  quota: "errors.kindQuota",
  auth: "errors.kindAuth",
  model: "errors.kindModel",
  rate: "errors.kindRate",
  overload: "errors.kindOverload",
} as const satisfies Record<ErrorKind, string>;

/**
 * Classified errors lead with what fixes them ("rejected the API key — check
 * it…") and keep the raw body after a colon, so splitErrorDetail still lifts
 * the provider's own line into the summary and the JSON behind Details.
 */
function providerErrorMessage(
  label: string,
  status: number,
  text: string,
  fallbackDetail: string,
): { message: string; kind?: ErrorKind } {
  const kind = classifyProviderError(status, text);
  if (kind) {
    const line = i18n.t(ERROR_KIND_KEYS[kind], { provider: label });
    return { message: text ? `${line}: ${text}` : line, kind };
  }
  return {
    message: i18n.t("errors.apiError", {
      provider: label,
      status,
      detail: text || fallbackDetail,
    }),
  };
}

/** Base + path joined once — trailing slashes on stored base URLs would double up. */
export function apiUrl(baseUrl: string, path: string): string {
  return `${baseUrl.replace(/\/$/, "")}${path}`;
}

/**
 * Anthropic dual-auth, shared by /v1/messages and /v1/models: Anthropic reads
 * x-api-key, coding-plan proxies (Kimi, Z.ai, QwenCloud) read Authorization:
 * Bearer — send both, each server picks its own.
 *
 * ponytail: MV3 host_permissions should bypass CORS already; the
 * direct-browser-access header is set defensively in case a gateway requires it.
 */
export function anthropicHeaders(apiKey: string): Record<string, string> {
  return {
    "x-api-key": apiKey,
    Authorization: `Bearer ${apiKey}`,
    "anthropic-version": "2023-06-01",
    "anthropic-dangerous-direct-browser-access": "true",
  };
}

/**
 * Anthropic OAuth requests — a subscription credential is a Bearer, not an
 * x-api-key, and the beta header is what switches the API into OAuth-token
 * mode. Shared by /v1/messages and /v1/models.
 *
 * ponytail: omits Claude Code's X-Claude-Code-Session-Id and X-Stainless-*
 * fingerprint headers — they're rate-limit/telemetry granularity, not an auth
 * gate, and the Stainless ones advertise a Node runtime the extension isn't.
 * Ceiling: if Anthropic starts rejecting clean OAuth requests, add the full
 * fingerprint set (opencodex's client-fingerprint.ts).
 */
export function anthropicOAuthHeaders(accessToken: string): Record<string, string> {
  return {
    Authorization: `Bearer ${accessToken}`,
    "anthropic-version": "2023-06-01",
    "anthropic-beta": "claude-code-20250219,oauth-2025-04-20",
    "anthropic-dangerous-direct-browser-access": "true",
    "x-client-request-id": crypto.randomUUID(),
  };
}

/** Tool-call args arrive in fragments and may end mid-JSON — parse defensively. */
export function parseToolArgs(raw: string): Record<string, unknown> {
  try {
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

/**
 * POST an SSE request and yield each `data:` payload, trimmed. The whole
 * transport envelope lives here once: non-2xx reads the body, logs it, and
 * throws the ProviderError both adapters surface; a missing body throws too.
 * Adapters keep only their per-event mapping.
 */
export async function* streamSse(opts: {
  url: string;
  headers: Record<string, string>;
  body: string;
  /** Provider label for the error envelope and the request log, e.g. "Anthropic". */
  label: string;
  signal: AbortSignal;
  /** Request metadata merged into the debug log (model, message/tool counts). */
  meta?: Record<string, unknown>;
}): AsyncGenerator<string> {
  const { url, headers, body, label, signal, meta } = opts;
  log.debug("request", { url, bytes: body.length, ...meta });

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body,
    signal,
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    log.error(`HTTP ${res.status} from ${url}: ${truncate(text)}`);
    const { message, kind } = providerErrorMessage(label, res.status, text, res.statusText);
    throw new ProviderError(message, res.status, kind);
  }

  if (!res.body) throw new Error(i18n.t("errors.noResponseBody"));

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || !trimmed.startsWith("data:")) continue;
        yield trimmed.slice(5).trim();
      }
    }
  } finally {
    reader.releaseLock();
  }
}
