import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Command, Event } from "@/shared/protocol";
import { PORT_NAME } from "@/shared/protocol";
import { useConversationStore } from "../ui/store";
import { appendMessageTo, setActiveConversation } from "../conversations";

/**
 * The panel's half of a compaction, against a fake port.
 *
 * The summary is written by the WORKER, into storage — and the panel watches
 * the conversation index and the run board, never a transcript. With no run in
 * flight nothing moves either of those, so the `compacted` event is the only
 * thing that can tell the panel to look. Miss it and the fold is invisible
 * until the next message happens to start a run, which is exactly the bug this
 * covers. The port drop is the other end of the same story: no event is ever
 * coming, so the live "Compacting…" row has to be taken down by hand.
 */

interface Fired {
  fireMessage: (e: Event) => void;
  fireDisconnect: () => void;
  posted: Command[];
}

function fakePort(): Fired {
  const message: Array<(e: Event) => void> = [];
  const disconnect: Array<() => void> = [];
  const posted: Command[] = [];
  const port = {
    name: PORT_NAME,
    postMessage: (cmd: Command) => void posted.push(cmd),
    onMessage: {
      addListener: (fn: (e: Event) => void) => message.push(fn),
      removeListener: () => {},
    },
    onDisconnect: {
      addListener: (fn: () => void) => disconnect.push(fn),
      removeListener: () => {},
    },
    disconnect: () => {},
  };
  (globalThis as Record<string, unknown>).chrome = {
    runtime: { connect: () => port as unknown as chrome.runtime.Port },
    tabs: { query: async () => [] },
    windows: { getCurrent: async () => ({ id: 1 }) },
  };
  return {
    fireMessage: (e) => message.forEach((fn) => fn(e)),
    fireDisconnect: () => disconnect.forEach((fn) => fn()),
    posted,
  };
}

/** The store's storage reads settle in microtasks — one macrotask drains them. */
const settled = () => new Promise((resolve) => setTimeout(resolve, 0));

let port: Fired;

beforeEach(async () => {
  vi.useRealTimers();
  // The live port is module state in the store — without this the next case
  // reuses the previous one's fake and never sees its own listeners fire.
  useConversationStore.getState().disconnect();
  port = fakePort();
  await setActiveConversation("c1");
  await appendMessageTo("c1", {
    id: "u1",
    role: "user",
    content: "compare the three listings",
    timestamp: 1,
  });
  useConversationStore.setState({ compacting: false, contextTokens: 0, status: "idle" });
  useConversationStore.getState().connect();
  await settled();
});

describe("a compaction the panel asked for", () => {
  it("pulls in the summary the worker wrote — nothing else would tell it to look", async () => {
    useConversationStore.getState().compact();
    expect(port.posted.some((c) => c.type === "compact")).toBe(true);
    expect(useConversationStore.getState().compacting).toBe(true);

    // The worker's write lands in storage while the panel shows its live row.
    await appendMessageTo("c1", {
      id: "s1",
      role: "summary",
      content: "1. Task: compare three listings…",
      timestamp: 2,
      compacted: { messages: 12, before: 18_400, after: 1_200 },
    });
    useConversationStore.setState({ contextTokens: 20_000 });
    port.fireMessage({ type: "compacted", messages: 12, before: 18_400, after: 1_200 });
    await settled();

    const state = useConversationStore.getState();
    expect(state.compacting).toBe(false);
    expect(state.messages.some((m) => m.role === "summary")).toBe(true);
    // The gauge moves when the work lands, not a turn later: 20k − (18.4k − 1.2k).
    expect(state.contextTokens).toBe(2_800);
  });

  it("takes its own live row down when the worker dies mid-fold", async () => {
    useConversationStore.getState().compact();
    expect(useConversationStore.getState().compacting).toBe(true);

    port.fireDisconnect();
    await settled();

    const state = useConversationStore.getState();
    // Otherwise the shimmer keeps promising a fold nobody is doing.
    expect(state.compacting).toBe(false);
    expect(state.messages.some((m) => m.content.startsWith("Couldn't compact:"))).toBe(true);
  });
});
