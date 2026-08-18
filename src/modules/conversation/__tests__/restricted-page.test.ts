import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Command, Event } from "@/shared/protocol";
import { PORT_NAME } from "@/shared/protocol";
import { useConversationStore } from "../ui/store";
import { runTargetPref } from "@/lib/prefs";

/**
 * "This page" on a page Chrome forbids extensions from touching. The task is
 * perfectly runnable — only the target is impossible — so the send degrades to
 * a tab of the run's own instead of dying on errors.restrictedPage with the
 * user's message already in the transcript. The composer says so before the
 * send; this covers the send itself, including the tab switched in between.
 *
 * Real store against a fake port, same seam as store-autosend.test.ts.
 */

interface FakePort {
  postMessage: ReturnType<typeof vi.fn>;
  onMessage: { addListener: (fn: (e: Event) => void) => void; removeListener: () => void };
  onDisconnect: { addListener: (fn: () => void) => void; removeListener: () => void };
  disconnect: () => void;
  name: string;
}

let port: FakePort;
let activeUrl: string;

function makePort(): FakePort {
  return {
    name: PORT_NAME,
    postMessage: vi.fn<(cmd: Command) => void>(),
    onMessage: { addListener: () => {}, removeListener: () => {} },
    onDisconnect: { addListener: () => {}, removeListener: () => {} },
    disconnect: () => {},
  };
}

function lastRunCommand(): Command | undefined {
  return port.postMessage.mock.calls.map(([c]) => c).findLast((c) => c.type === "run");
}

beforeEach(async () => {
  port = makePort();
  activeUrl = "https://example.com";
  await runTargetPref.set("thisPage");
  (globalThis as Record<string, unknown>).chrome = {
    runtime: { connect: () => port as unknown as chrome.runtime.Port },
    tabs: {
      query: async () => [{ id: 1, active: true, url: activeUrl, title: "Active tab" }],
    },
    windows: { getCurrent: async () => ({ id: 1 }) },
  };
  useConversationStore.getState().disconnect();
  useConversationStore.setState({
    messages: [],
    conversations: [],
    activeId: null,
    status: "idle",
    lastRun: null,
    runTarget: "thisPage",
    queued: [],
    pendingSend: null,
    draft: "",
  });
});

afterEach(() => useConversationStore.getState().disconnect());

describe("a restricted page under “This page”", () => {
  it("runs in a tab of its own instead of erroring", async () => {
    activeUrl = "chrome://extensions";
    const s = useConversationStore.getState();
    s.connect();
    await s.sendTask("summarize my inbox");

    expect(lastRunCommand()).toEqual({
      type: "run",
      conversationId: useConversationStore.getState().activeId,
      task: "summarize my inbox",
    });
    // No stamp either — a chrome:// chip under the message would name a tab the
    // run never drove.
    const sent = useConversationStore.getState().messages.findLast((m) => m.role === "user");
    expect(sent?.tab).toBeUndefined();
    expect(useConversationStore.getState().messages.some((m) => m.role === "error")).toBe(false);
  });

  it("does not turn the send into a walk-away", async () => {
    activeUrl = "https://chromewebstore.google.com/detail/tabrunner/abc";
    const s = useConversationStore.getState();
    s.connect();
    await s.sendTask("what is this extension");

    // The user chose to watch. The fallback moved the run's tab, not their mode
    // — so approvePlan must not close the panel out from under them.
    expect(useConversationStore.getState().lastRun?.thisPage).toBe(true);
  });

  it("leaves an ordinary page driving the user's tab", async () => {
    const s = useConversationStore.getState();
    s.connect();
    await s.sendTask("summarize this");

    expect(lastRunCommand()).toEqual({
      type: "run",
      conversationId: useConversationStore.getState().activeId,
      task: "summarize this",
      thisPage: true,
    });
    const sent = useConversationStore.getState().messages.findLast((m) => m.role === "user");
    expect(sent?.tab?.url).toBe("https://example.com");
  });
});
