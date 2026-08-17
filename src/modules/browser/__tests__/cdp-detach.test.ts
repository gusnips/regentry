import { describe, it, expect, vi } from "vitest";

// @/i18n (pulled in via cdp-driver) reads wxt storage at module scope — no chrome in tests.
vi.mock("wxt/utils/storage", () => ({
  storage: {
    defineItem: (_key: string, opts?: { fallback?: unknown }) => ({
      getValue: async () => opts?.fallback ?? null,
      setValue: async () => {},
      removeValue: async () => {},
      watch: () => () => {},
    }),
  },
}));

vi.mock("../indicator", () => ({ refreshAgentIndicator: vi.fn(async () => {}) }));

const attached: number[] = [];
const detached: number[] = [];
/** Tabs whose detach should fail — a died-or-cancelled tab must not stop the sweep. */
const detachRefusals = new Set<number>();

(globalThis as Record<string, unknown>).chrome = {
  tabs: {
    onRemoved: { addListener: () => {}, removeListener: () => {} },
    onUpdated: { addListener: () => {}, removeListener: () => {} },
  },
  debugger: {
    onDetach: { addListener: () => {} },
    onEvent: { addListener: () => {} },
    attach: async (target: { tabId: number }) => {
      attached.push(target.tabId);
    },
    detach: async (target: { tabId: number }) => {
      if (detachRefusals.has(target.tabId)) throw new Error("No tab with given id");
      detached.push(target.tabId);
    },
    sendCommand: async () => ({}),
  },
};

const { ensureAttached, detachAll } = await import("../cdp-driver");

describe("detachAll", () => {
  it("detaches every attached tab, and clears state so the next run re-attaches", async () => {
    await ensureAttached(1);
    await ensureAttached(2);
    // A second ensure on a held tab is a re-target, not a re-attach.
    await ensureAttached(1);
    expect(attached).toEqual([1, 2]);

    await detachAll();
    expect(detached).toEqual([1, 2]);

    attached.length = 0;
    await ensureAttached(1);
    expect(attached).toEqual([1]);
  });

  it("a tab that refuses to detach neither throws nor stops the sweep", async () => {
    await ensureAttached(3);
    await ensureAttached(4);
    detachRefusals.add(3);

    await expect(detachAll()).resolves.toBeUndefined();
    expect(detached).toContain(4);

    // State was cleared despite the refusal — nothing retries the dead tab.
    detachRefusals.clear();
    detached.length = 0;
    await detachAll();
    expect(detached).toEqual([]);
  });
});
