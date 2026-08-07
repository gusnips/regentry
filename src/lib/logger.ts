/** Prefixed logger — keeps background/console output identifiable. */
export const log = {
  debug: (...args: unknown[]) => console.debug("[regent]", ...args),
  info: (...args: unknown[]) => console.info("[regent]", ...args),
  warn: (...args: unknown[]) => console.warn("[regent]", ...args),
  error: (...args: unknown[]) => console.error("[regent]", ...args),
};
