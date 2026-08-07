import { describe, it, expect, vi } from "vitest";

// The storage item is created at module load; jsdom has no browser.runtime.
vi.mock("wxt/utils/storage", () => ({
  storage: {
    defineItem: <T>(_key: string, opts: { fallback: T }) => ({
      getValue: () => Promise.resolve(opts.fallback),
      setValue: () => Promise.resolve(),
      removeValue: () => Promise.resolve(),
      watch: () => () => {},
    }),
  },
}));

import { resolveDark } from "../theme";

describe("resolveDark", () => {
  it("explicit light/dark override the OS", () => {
    expect(resolveDark("light", true)).toBe(false);
    expect(resolveDark("dark", false)).toBe(true);
  });

  it("system follows the OS", () => {
    expect(resolveDark("system", true)).toBe(true);
    expect(resolveDark("system", false)).toBe(false);
  });
});
