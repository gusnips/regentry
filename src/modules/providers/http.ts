import { ProviderError } from "./types";
import { createLogger, truncate } from "@/lib/logger";
import { i18n } from "@/i18n";

const log = createLogger("providers");

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
    throw new ProviderError(
      i18n.t("errors.apiError", {
        provider: label,
        status: res.status,
        detail: text || res.statusText,
      }),
      res.status,
    );
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
