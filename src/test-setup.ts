/**
 * Minimal chrome surface for tests. Modules like cdp-driver register event
 * listeners at import time — real in the extension, absent under vitest.
 * Individual tests replace globalThis.chrome with richer stubs as needed.
 */
if (typeof globalThis.chrome === "undefined") {
  const noop = { addListener: () => {}, removeListener: () => {} };
  (globalThis as Record<string, unknown>).chrome = {
    tabs: { onRemoved: noop, onUpdated: noop },
    debugger: { onDetach: noop },
  };
}
