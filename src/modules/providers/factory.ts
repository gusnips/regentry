import type { ChatProvider, ProviderConfig } from "./types";
import { createOpenAIProvider } from "./openai";
import { createAnthropicProvider } from "./anthropic";

/** Factory — picks adapter by shape. Adding a new shape = one case here. */
export function createProvider(config: ProviderConfig): ChatProvider {
  switch (config.shape) {
    case "openai":
      return createOpenAIProvider(config);
    case "anthropic":
      return createAnthropicProvider(config);
  }
}
