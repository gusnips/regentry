import { describe, it, expect, vi, beforeEach } from "vitest";

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

interface TabStub {
  id: number;
  windowId: number;
  url: string;
  status: string;
}
type Listener = (id: number, info: { status?: string }, tab: TabStub) => void;

const tab: TabStub = { id: 1, windowId: 10, url: "https://example.com", status: "complete" };
const listeners = new Set<Listener>();

(globalThis as Record<string, unknown>).chrome = {
  tabs: {
    onRemoved: { addListener: () => {}, removeListener: () => {} },
    onUpdated: {
      addListener: (fn: Listener) => listeners.add(fn),
      removeListener: (fn: Listener) => listeners.delete(fn),
    },
    // Both callers use the callback form Chrome offers alongside the promise one.
    get: (_id: number, cb?: (t: TabStub) => void) => {
      if (cb) queueMicrotask(() => cb(tab));
      return Promise.resolve(tab);
    },
  },
  debugger: { onDetach: { addListener: () => {} }, onEvent: { addListener: () => {} } },
};

const { settleIfLoading } = await import("../cdp-driver");

/** Let every pending microtask and 0ms timer drain. */
const flush = () => new Promise((r) => setTimeout(r, 0));

/** What Chrome does on a status change: the tab moves, then listeners hear it. */
async function emit(status: string) {
  tab.status = status;
  for (const fn of [...listeners]) fn(tab.id, { status }, tab);
  await flush();
}

describe("settleIfLoading", () => {
  beforeEach(() => {
    listeners.clear();
    tab.status = "complete";
  });

  it("reports no load when the window passes quietly — the common click", async () => {
    await expect(settleIfLoading(1, 20)).resolves.toBe(false);
    expect(listeners.size).toBe(0);
  });

  it("rides out a load that starts inside the window", async () => {
    let settled: boolean | undefined;
    const settling = settleIfLoading(1, 1000).then((v) => (settled = v));

    await emit("loading");
    // Seeing the load start is not the point — arriving after it finishes is.
    expect(settled).toBeUndefined();

    await emit("complete");
    await settling;
    expect(settled).toBe(true);
    expect(listeners.size).toBe(0);
  });

  it("catches a load already in flight when the action's promise settles", async () => {
    tab.status = "loading";
    let settled: boolean | undefined;
    const settling = settleIfLoading(1, 20).then((v) => (settled = v));
    await flush();
    // The window has long expired by now; the load was seen on entry, not by event.
    await new Promise((r) => setTimeout(r, 40));
    expect(settled).toBeUndefined();

    await emit("complete");
    await settling;
    expect(settled).toBe(true);
    expect(listeners.size).toBe(0);
  });
});
