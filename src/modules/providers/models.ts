import type { ModelInfo, ProviderConfig, ResolvedProviderConfig } from "./types";
import { ProviderError } from "./types";
import { PRESETS } from "./presets";
import { anthropicHeaders, apiUrl } from "./http";
import { i18n } from "@/i18n";

/**
 * Live model listing — the anti-staleness seam. Both wire shapes expose a
 * list route (anthropic: GET {base}/v1/models, openai: GET {base}/models);
 * presets are only the fallback when an endpoint doesn't (QwenCloud 404s).
 */
export async function listModels(
  config: Pick<ProviderConfig, "shape" | "baseUrl" | "apiKey">,
): Promise<ModelInfo[]> {
  const url = apiUrl(config.baseUrl, config.shape === "anthropic" ? "/v1/models" : "/models");
  const headers: Record<string, string> =
    config.shape === "anthropic"
      ? anthropicHeaders(config.apiKey)
      : { Authorization: `Bearer ${config.apiKey}` };

  const res = await fetch(url, { headers });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new ProviderError(
      i18n.t("errors.modelListError", { status: res.status, detail: text || res.statusText }),
      res.status,
    );
  }

  const entries = parseModelEntries(await res.json());
  return config.shape === "openai" ? entries.filter((m) => !isNonChatModel(m.id)) : entries;
}

/** Newest model wins; ties or missing timestamps fall back to list order. */
export function pickLatestModel(models: ModelInfo[]): ModelInfo | undefined {
  let best: ModelInfo | undefined;
  for (const m of models) {
    if (!best || (m.created ?? -Infinity) >= (best.created ?? -Infinity)) best = m;
  }
  return best;
}

/**
 * Resolve the config's effective model: the user's persisted choice, else the
 * newest the endpoint serves, else the preset's first entry. Throws a clear
 * error when none of the three works — never sends an empty model upstream.
 */
export async function resolveProviderModel(
  config: ProviderConfig,
): Promise<ResolvedProviderConfig> {
  if (config.model) return { ...config, model: config.model };

  try {
    const latest = pickLatestModel(await listModels(config));
    if (latest) return { ...config, model: latest.id };
  } catch {
    // Endpoint has no list route (or is unreachable) — fall through to preset.
  }

  const presetFallback = PRESETS.find((p) => p.id === config.id)?.models[0];
  if (presetFallback) return { ...config, model: presetFallback };

  throw new ProviderError(i18n.t("errors.noModel", { name: config.name }), 0);
}

function parseModelEntries(body: unknown): ModelInfo[] {
  const data = (body as { data?: unknown } | null)?.data;
  if (!Array.isArray(data)) throw new ProviderError(i18n.t("errors.noModelData"), 0);
  const out: ModelInfo[] = [];
  for (const entry of data) {
    const record = (entry ?? {}) as Record<string, unknown>;
    const id = record.id;
    if (typeof id !== "string" || !id) continue;
    out.push({ id, name: parseName(record, id), created: parseCreated(record) });
  }
  return out;
}

/** Anthropic lists `display_name`, OpenRouter-style endpoints list `name`; plain OpenAI has neither. */
function parseName(entry: Record<string, unknown>, id: string): string | undefined {
  for (const key of ["display_name", "name"]) {
    const value = entry[key];
    if (typeof value === "string" && value.trim() && value !== id) return value.trim();
  }
  return undefined;
}

/** Endpoints report `created` (unix s) and/or `created_at` (ISO) — normalize to ms. */
function parseCreated(entry: Record<string, unknown>): number | undefined {
  if (typeof entry.created === "number" && Number.isFinite(entry.created)) {
    return entry.created * 1000;
  }
  if (typeof entry.created_at === "string") {
    const ms = Date.parse(entry.created_at);
    if (Number.isFinite(ms)) return ms;
  }
  return undefined;
}

// ponytail: name heuristic — big OpenAI-shape catalogs (OpenAI, OpenRouter,
// Gemini) mix embeddings/tts/image/live/realtime models into /models. Ceiling:
// a chat model with an unlucky name gets hidden; it stays reachable via free-text entry.
const NON_CHAT_PATTERN =
  /embed|whisper|tts|dall-e|image|moderation|realtime|audio|transcrib|search-preview|-live/i;

function isNonChatModel(id: string): boolean {
  return NON_CHAT_PATTERN.test(id);
}
