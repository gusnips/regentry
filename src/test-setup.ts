/**
 * Shared test bootstrap, installed via vitest `setupFiles` — do not import it.
 *
 * - Minimal chrome surface: modules like cdp-driver register event listeners
 *   at import time — real in the extension, absent under vitest. Individual
 *   tests replace globalThis.chrome with richer stubs as needed.
 * - In-memory chrome.storage.local: one entry per defineItem key (the
 *   keyed-Map shape is what makes per-conversation keys observable). Reset
 *   between tests so every case starts from a clean store.
 * - The en i18n catalog: production initI18n reads storage, tests load it
 *   directly.
 */
import { beforeAll, beforeEach, vi } from "vitest";
import { i18n } from "@/i18n";
import en from "@/i18n/locales/en.json";

if (typeof globalThis.chrome === "undefined") {
  const noop = { addListener: () => {}, removeListener: () => {} };
  (globalThis as Record<string, unknown>).chrome = {
    tabs: { onRemoved: noop, onUpdated: noop },
    debugger: { onDetach: noop },
  };
}

const values = new Map<string, unknown>();
vi.mock("wxt/utils/storage", () => ({
  storage: {
    defineItem: <T>(key: string, opts: { fallback: T }) => ({
      getValue: () => Promise.resolve(values.has(key) ? (values.get(key) as T) : opts.fallback),
      setValue: (v: T) => {
        values.set(key, v);
        return Promise.resolve();
      },
      removeValue: () => {
        values.delete(key);
        return Promise.resolve();
      },
      watch: () => () => {},
    }),
  },
}));

beforeAll(async () => {
  await i18n.init({
    resources: { en: { translation: en } },
    lng: "en",
    interpolation: { escapeValue: false },
    returnEmptyString: false,
  });
});

beforeEach(() => values.clear());
