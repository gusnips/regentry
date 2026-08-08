import type { ProviderShape } from "./types";
import { i18n } from "@/i18n";

/** Preset provider — just data, no code. Adding a provider starts here. */
export interface ProviderPreset {
  id: string;
  name: string;
  shape: ProviderShape;
  baseUrl: string;
  models: string[];
  apiKeyUrl?: string;
  /** Brand accent for the icon tile */
  color: string;
  /** Key into the icon set in ui/ProviderIcon */
  icon: IconKey;
  /**
   * Whether this family's models can receive images. Absent = capable. Only
   * DeepSeek is text-only. No provider ships per-model vision in its listing,
   * so the family flag is the single source of truth.
   */
  supportsImages?: boolean;
  /**
   * Present when the provider is signed into instead of keyed. The form swaps
   * the key field for a sign-in button and the list offers signing out.
   */
  auth?: "oauth";
}

export type IconKey =
  | "openai"
  | "anthropic"
  | "deepseek"
  | "kimi"
  | "zai"
  | "qwen"
  | "gemini"
  | "groq"
  | "openrouter"
  | "ollama"
  | "mistral"
  | "xai";

/**
 * Built-in presets. Users can also add custom OpenAI-compatible endpoints.
 *
 * Order is the picker's order, and the first entry is what the add form opens
 * on: the subscriptions lead, because a plan someone already pays for is the
 * shortest path to a working provider — an API key means a console, a credit
 * card, and a billing decision before the first task ever runs.
 *
 * The "coding plan" endpoints (Kimi, Z.ai, QwenCloud) speak the Anthropic wire
 * format at custom base URLs — that's why they're anthropic-shaped presets,
 * not custom configs.
 */
export const PRESETS: ProviderPreset[] = [
  {
    // The same API as `anthropic`, reached with a Claude subscription (Pro/Max)
    // sign-in instead of a key. One row per way to pay — a user with both a key
    // and a plan always knows which quota a run spends.
    id: "claude",
    name: "Anthropic",
    shape: "anthropic",
    baseUrl: "https://api.anthropic.com",
    models: ["claude-fable-5", "claude-opus-5", "claude-sonnet-5", "claude-haiku-4-5-20251001"],
    auth: "oauth",
    color: "#D97757",
    icon: "anthropic",
  },
  {
    // The Codex agent backend behind a ChatGPT Plus/Pro sign-in instead of a
    // key — the same quota your ChatGPT subscription pays for. It speaks the
    // Responses wire format at a backend with no public model-list route, so
    // the preset models ARE the picker's list.
    id: "chatgpt",
    name: "OpenAI",
    shape: "responses",
    baseUrl: "https://chatgpt.com/backend-api/codex",
    models: ["gpt-5.4-mini", "gpt-5.5", "gpt-5.3-codex", "gpt-5.1-codex-max"],
    auth: "oauth",
    color: "#10A37F",
    icon: "openai",
  },
  {
    // The same coding endpoint as `kimi`, reached with a subscription sign-in
    // instead of a key. Kimi bills the two separately, so they stay separate
    // rows — a user with both always knows which quota a run spends.
    id: "kimi-plan",
    name: "Kimi Coding",
    shape: "anthropic",
    baseUrl: "https://api.kimi.com/coding",
    models: ["k3", "k3-256k", "kimi-for-coding", "kimi-for-coding-highspeed"],
    auth: "oauth",
    color: "#0F172A",
    icon: "kimi",
  },
  {
    id: "anthropic",
    name: "Anthropic (API)",
    shape: "anthropic",
    baseUrl: "https://api.anthropic.com",
    models: ["claude-fable-5", "claude-opus-5", "claude-sonnet-5", "claude-haiku-4-5-20251001"],
    apiKeyUrl: "https://console.anthropic.com/settings/keys",
    color: "#D97757",
    icon: "anthropic",
  },
  {
    id: "openai",
    name: "OpenAI (API)",
    shape: "openai",
    baseUrl: "https://api.openai.com/v1",
    models: ["gpt-5", "gpt-5-mini", "gpt-4o"],
    apiKeyUrl: "https://platform.openai.com/api-keys",
    color: "#000000",
    icon: "openai",
  },
  {
    id: "kimi",
    name: "Kimi Coding (API)",
    shape: "anthropic",
    baseUrl: "https://api.kimi.com/coding",
    models: ["k3", "k3-256k", "kimi-for-coding", "kimi-for-coding-highspeed"],
    apiKeyUrl: "https://platform.moonshot.ai/console/api-keys",
    color: "#0F172A",
    icon: "kimi",
  },
  {
    id: "zai",
    name: "Z.ai Coding",
    shape: "anthropic",
    baseUrl: "https://api.z.ai/api/anthropic",
    models: ["glm-5.2", "glm-4.7"],
    apiKeyUrl: "https://z.ai/manage-apikey/apikey-list",
    color: "#3B5BFD",
    icon: "zai",
  },
  {
    id: "qwen",
    name: "Qwen",
    shape: "anthropic",
    baseUrl: "https://token-plan.ap-southeast-1.maas.aliyuncs.com/apps/anthropic",
    models: ["qwen3.8-max", "qwen3.6-flash"],
    apiKeyUrl: "https://bailian.console.aliyun.com/",
    color: "#615CED",
    icon: "qwen",
  },
  {
    id: "deepseek",
    name: "DeepSeek",
    shape: "openai",
    baseUrl: "https://api.deepseek.com",
    models: ["deepseek-chat", "deepseek-reasoner"],
    apiKeyUrl: "https://platform.deepseek.com/api_keys",
    color: "#4D6BFE",
    icon: "deepseek",
    // Text-only API — a screenshot (image_url) in the body is a hard 400.
    supportsImages: false,
  },
  {
    id: "gemini",
    name: "Gemini",
    shape: "openai",
    baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai",
    models: ["gemini-2.5-pro", "gemini-2.5-flash"],
    apiKeyUrl: "https://aistudio.google.com/apikey",
    color: "#1E88E5",
    icon: "gemini",
  },
  {
    id: "openrouter",
    name: "OpenRouter",
    shape: "openai",
    baseUrl: "https://openrouter.ai/api/v1",
    models: [],
    apiKeyUrl: "https://openrouter.ai/settings/keys",
    color: "#334155",
    icon: "openrouter",
  },
  {
    id: "groq",
    name: "Groq",
    shape: "openai",
    baseUrl: "https://api.groq.com/openai/v1",
    models: ["llama-3.3-70b-versatile"],
    apiKeyUrl: "https://console.groq.com/keys",
    color: "#F55036",
    icon: "groq",
  },
  {
    id: "mistral",
    name: "Mistral",
    shape: "openai",
    baseUrl: "https://api.mistral.ai/v1",
    models: ["mistral-large-latest", "mistral-small-latest"],
    apiKeyUrl: "https://console.mistral.ai/api-keys/",
    color: "#FF7000",
    icon: "mistral",
  },
  {
    id: "xai",
    name: "xAI",
    shape: "openai",
    baseUrl: "https://api.x.ai/v1",
    models: ["grok-4", "grok-4-fast"],
    apiKeyUrl: "https://console.x.ai/",
    color: "#000000",
    icon: "xai",
  },
  {
    id: "ollama",
    name: "Ollama",
    shape: "openai",
    baseUrl: "http://localhost:11434/v1",
    models: [],
    color: "#000000",
    icon: "ollama",
  },
];

/**
 * Label for a stored provider. The preset's current name wins over the copy
 * saved into the config at add time, so renaming a preset shows up everywhere
 * without asking the user to re-save.
 */
export function providerDisplayName(provider: { id: string; name: string }): string {
  const preset = PRESETS.find((p) => p.id === provider.id);
  if (!preset) return provider.name;
  // OAuth rows append a localized payment-method label — the preset name stays
  // clean so the plan word reads in the user's language. "(API)" is the same
  // acronym in every language, so keyed rows keep it baked into the name.
  return preset.auth === "oauth"
    ? `${preset.name} (${i18n.t("common.subscription")})`
    : preset.name;
}
