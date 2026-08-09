import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { acquireRun, getActiveRun, releaseRun } from "@/modules/agent/active-runs";
import type { Event } from "@/shared/protocol";
import type { ProviderConfig } from "@/modules/providers/types";
import type { DaemonMessage } from "../protocol";

/**
 * The panel indicator. bridge.ts must say, truthfully, when an external client
 * is working in the browser — a delegated run, or a direct-driving session —
 * and stop saying it the moment the work ends. The panel band, the driven tab's
 * favicon dot and the on-page badge all key off this one getter, so the
 * lifecycle is the part worth pinning: set on start, cleared on done/error,
 * cleared when a direct session closes (stop and idle expiry included).
 *
 * The socket, the run engine and the browser are all mocked: this drives the
 * request wiring and the activity transitions, not CDP or streaming.
 */

const socketHandlers: { onMessage?: (msg: DaemonMessage) => void } = {};
const sendSpy = vi.fn();
let emitRunEvent: ((e: Event) => void) | null = null;

vi.mock("@/modules/bridge/ws-client", () => ({
  BridgeSocket: class {
    send = sendSpy;
    constructor(onMessage: (msg: DaemonMessage) => void) {
      socketHandlers.onMessage = onMessage;
    }
    start(): void {}
  },
}));
vi.mock("@/modules/agent/start-run", () => ({
  startAgentRun: (opts: { emit: (e: Event) => void }) => {
    emitRunEvent = opts.emit;
    return Promise.resolve({ ok: true });
  },
}));
vi.mock("@/modules/conversation", () => ({
  appendMessageTo: () => Promise.resolve(),
  openAgentConversation: () => Promise.resolve(),
}));
vi.mock("@/modules/conversation/transcript", () => ({
  TranscriptWriter: class {
    apply(): void {}
  },
}));
vi.mock("@/modules/browser", () => ({
  createDriver: () => ({}),
  showAgentIndicator: () => Promise.resolve(),
  hideAgentIndicator: () => Promise.resolve(),
  isRestrictedUrl: () => false,
  waitForLoad: () => Promise.resolve(),
  captureVisibleTab: () => Promise.resolve({ data: "data:image/jpeg;base64,AA==", tabId: 7 }),
}));
let activeProvider: ProviderConfig | null = null;
vi.mock("@/modules/providers", () => ({
  getActiveProvider: () => Promise.resolve(activeProvider),
}));
vi.mock("@/modules/agent/tools", () => ({
  executeTool: () => Promise.resolve({ ok: true, data: { pageContent: "[ref=e1] button" } }),
  formatSuccessSummary: () => "did the thing",
  formatDetail: () => undefined,
}));

const { Bridge } = await import("../bridge");

type Activity = { mode: "run" | "direct"; client: string } | null;

beforeEach(() => {
  sendSpy.mockClear();
  emitRunEvent = null;
  activeProvider = null;
  delete socketHandlers.onMessage;
  (globalThis.chrome as Record<string, unknown>).tabs = {
    query: () => Promise.resolve([{ id: 7, windowId: 1, title: "Inbox", url: "https://x.test/" }]),
    onRemoved: { addListener: () => {}, removeListener: () => {} },
    onUpdated: { addListener: () => {}, removeListener: () => {} },
  };
});

afterEach(() => {
  const run = getActiveRun();
  if (run) releaseRun(run);
});

describe("Bridge activity", () => {
  it("names the client during a delegated run and falls silent when it ends", async () => {
    const seen: Activity[] = [];
    const bridge = new Bridge((active) => seen.push(active));
    bridge.start();

    socketHandlers.onMessage?.({
      type: "request",
      requestId: "r1",
      method: "run",
      params: { task: "do the thing", agent: "Claude Code" },
    });
    await vi.waitFor(() => expect(bridge.activity).toEqual({ mode: "run", client: "Claude Code" }));
    expect(seen).toEqual([{ mode: "run", client: "Claude Code" }]);

    // Activity is set before launch() reaches startAgentRun, which is what
    // captures the emit callback — wait for the capture, or the done lands on
    // nothing and the run reads as still live.
    await vi.waitFor(() => expect(emitRunEvent).not.toBeNull());
    emitRunEvent?.({ type: "done", summary: "done" });
    await vi.waitFor(() => expect(bridge.activity).toBeNull());
    expect(seen).toEqual([{ mode: "run", client: "Claude Code" }, null]);
  });

  it("clears activity on a run error too", async () => {
    const bridge = new Bridge();
    bridge.start();

    socketHandlers.onMessage?.({
      type: "request",
      requestId: "r1",
      method: "run",
      params: { task: "do the thing", agent: "Claude Code" },
    });
    await vi.waitFor(() => expect(bridge.activity).not.toBeNull());
    await vi.waitFor(() => expect(emitRunEvent).not.toBeNull());

    emitRunEvent?.({ type: "error", message: "provider blew up" });
    await vi.waitFor(() => expect(bridge.activity).toBeNull());
  });

  it("names the client during direct driving and falls silent when the session closes", async () => {
    const seen: Activity[] = [];
    const bridge = new Bridge((active) => seen.push(active));
    bridge.start();

    socketHandlers.onMessage?.({
      type: "request",
      requestId: "r2",
      method: "browserStart",
      params: { goal: "find the invoice", agent: "Claude Code" },
    });
    await vi.waitFor(() =>
      expect(bridge.activity).toEqual({ mode: "direct", client: "Claude Code" }),
    );
    expect(seen).toEqual([{ mode: "direct", client: "Claude Code" }]);

    socketHandlers.onMessage?.({
      type: "request",
      requestId: "r3",
      method: "browserEnd",
      params: {},
    });
    await vi.waitFor(() => expect(bridge.activity).toBeNull());
    expect(seen).toEqual([{ mode: "direct", client: "Claude Code" }, null]);
  });

  it("does not claim the browser when a direct session refuses to open", async () => {
    // The panel holds the slot — browser_start must fail without activity, and
    // the refusal has to reach the client, not die in the bridge.
    acquireRun("panel-conversation", "panel");
    const bridge = new Bridge();
    bridge.start();

    socketHandlers.onMessage?.({
      type: "request",
      requestId: "r4",
      method: "browserStart",
      params: { goal: "find the invoice", agent: "Claude Code" },
    });
    await vi.waitFor(() =>
      expect(sendSpy).toHaveBeenCalledWith(expect.objectContaining({ requestId: "r4", ok: false })),
    );

    expect(bridge.activity).toBeNull();
  });
});

/**
 * health asks this before a task is sent: a reachable browser with no usable
 * provider is a run that dies on its first model call. Every field feeds a
 * different line of the answer, so each one is worth pinning.
 */
describe("Bridge providerInfo", () => {
  const ask = async (requestId: string) => {
    const bridge = new Bridge();
    bridge.start();
    socketHandlers.onMessage?.({ type: "request", requestId, method: "providerInfo", params: {} });
    await vi.waitFor(() =>
      expect(sendSpy).toHaveBeenCalledWith(expect.objectContaining({ requestId })),
    );
    const call = sendSpy.mock.calls.find(
      (c) => (c[0] as { requestId?: string }).requestId === requestId,
    );
    return (call?.[0] as { result: unknown }).result;
  };

  it("reports a signed-in subscription as ready, under its display name", async () => {
    activeProvider = {
      id: "claude",
      name: "Anthropic",
      shape: "anthropic",
      baseUrl: "https://api.anthropic.com",
      apiKey: "",
      auth: { accessToken: "at", refreshToken: "rt", expiresAt: 0 },
      createdAt: 0,
    };
    expect(await ask("p1")).toEqual({
      name: "Anthropic (Subscription)",
      ready: true,
      auth: "subscription",
      model: null,
    });
  });

  it("reports a keyless provider as not ready, so health can say which fix applies", async () => {
    activeProvider = {
      id: "openai",
      name: "OpenAI (API)",
      shape: "openai",
      baseUrl: "https://api.openai.com/v1",
      apiKey: "",
      model: "gpt-5",
      createdAt: 0,
    };
    expect(await ask("p2")).toEqual({
      name: "OpenAI (API)",
      ready: false,
      auth: "key",
      model: "gpt-5",
    });
  });

  it("reports no provider at all rather than failing the request", async () => {
    expect(await ask("p3")).toEqual({ name: null, ready: false, auth: null, model: null });
  });
});
