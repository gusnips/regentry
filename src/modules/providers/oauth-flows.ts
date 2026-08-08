import type { OAuthCredential } from "./types";
import { refreshCredential as refreshClaude, signInWithClaude } from "./claude-oauth";
import { refreshCredential as refreshChatGPT, signInWithChatGPT } from "./chatgpt-oauth";
import { pollForToken, refreshCredential as refreshKimi, requestDeviceCode } from "./kimi-oauth";

/** What the user must do on the vendor's page to finish signing in. */
export interface SignInPrompt {
  /** The approval page — opened in a tab, and offered as a link if that was blocked. */
  url: string;
  /** Device-code flows only: the code that page asks for. */
  userCode?: string;
}

/** A signed-in provider's two operations — sign in once, then renew forever. */
export interface OAuthFlow {
  signIn: (
    signal: AbortSignal,
    onPrompt: (prompt: SignInPrompt) => void,
  ) => Promise<OAuthCredential>;
  refresh: (credential: OAuthCredential) => Promise<OAuthCredential>;
}

/**
 * Every OAuth preset's flow, keyed by preset id. One registry, read by both the
 * sign-in card and the credential seam, so a provider can never be half-wired —
 * signable but not refreshable, or the reverse. Adding one is a single entry
 * here plus its `auth: "oauth"` preset.
 *
 * The vendor differences end up being exactly two: how the approval page is
 * reached, and whether it also shows a code.
 */
export const OAUTH_FLOWS: Record<string, OAuthFlow> = {
  claude: {
    signIn: (signal, onPrompt) => signInWithClaude(signal, (url) => onPrompt({ url })),
    refresh: refreshClaude,
  },
  chatgpt: {
    signIn: (signal, onPrompt) => signInWithChatGPT(signal, (url) => onPrompt({ url })),
    refresh: refreshChatGPT,
  },
  "kimi-plan": {
    signIn: async (signal, onPrompt) => {
      const prompt = await requestDeviceCode();
      onPrompt({ url: prompt.verificationUrl, userCode: prompt.userCode });
      // Pre-filled approval page. If the browser blocks it, the code stays on
      // screen as the fallback — that's why it's shown while we wait.
      void chrome.tabs.create({ url: prompt.verificationUrl });
      return pollForToken(prompt, signal);
    },
    refresh: refreshKimi,
  },
};
