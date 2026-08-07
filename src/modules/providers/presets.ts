import type { ProviderShape } from "./types";

/** Preset provider — just data, no code. Adding a provider starts here. */
export interface ProviderPreset {
  id: string;
  name: string;
  shape: ProviderShape;
  baseUrl: string;
  models: string[];
  apiKeyUrl?: string;
}

/**
 * Built-in presets. Users can also add custom OpenAI-compatible endpoints.
 */
export const PRESETS: ProviderPreset[] = [
  {
    id: "openai",
    name: "OpenAI",
    shape: "openai",
    baseUrl: "https://api.openai.com/v1",
    models: ["gpt-4o", "gpt-4o-mini", "o3", "o4-mini"],
    apiKeyUrl: "https://platform.openai.com/api-keys",
  },
  {
    id: "anthropic",
    name: "Anthropic",
    shape: "anthropic",
    baseUrl: "https://api.anthropic.com",
    models: ["claude-sonnet-5", "claude-haiku-4-5-20251001"],
    apiKeyUrl: "https://console.anthropic.com/settings/keys",
  },
  {
    id: "openrouter",
    name: "OpenRouter",
    shape: "openai",
    baseUrl: "https://openrouter.ai/api/v1",
    models: [],
  },
  {
    id: "groq",
    name: "Groq",
    shape: "openai",
    baseUrl: "https://api.groq.com/openai/v1",
    models: [],
  },
  {
    id: "deepseek",
    name: "DeepSeek",
    shape: "openai",
    baseUrl: "https://api.deepseek.com",
    models: [],
  },
  {
    id: "ollama",
    name: "Ollama (local)",
    shape: "openai",
    baseUrl: "http://localhost:11434/v1",
    models: [],
  },
];
