import { beforeEach, describe, expect, it, vi } from "vitest";
import { bridgeConnected, bridgeItem, validBridgePort } from "../config";
import { BridgeSocket } from "../ws-client";

/**
 * The bridge's cost when nobody is using it is the thing worth pinning down:
 * almost every user runs no daemon, so "no daemon listening" is the normal
 * path, not the edge case. It must cost one alarm every 30s and nothing else.
 */

class FakeSocket {
  static instances: FakeSocket[] = [];
  static readonly OPEN = 1;
  readyState = 0;
  onopen: (() => void) | null = null;
  onmessage: ((e: { data: string }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;

  constructor(readonly url: string) {
    FakeSocket.instances.push(this);
  }
  send(): void {}
  /** What a refused connection does: error, then close, never having opened. */
  refuse(): void {
    this.onerror?.();
    this.close();
  }
  open(): void {
    this.readyState = FakeSocket.OPEN;
    this.onopen?.();
  }
  close(): void {
    this.readyState = 3;
    this.onclose?.();
  }
}

const alarmCalls = { created: [] as string[], cleared: [] as string[] };

beforeEach(() => {
  FakeSocket.instances = [];
  alarmCalls.created = [];
  alarmCalls.cleared = [];
  vi.useFakeTimers();
  // Tests own the globals the class reaches for; both are real only in Chrome.
  globalThis.WebSocket = FakeSocket as unknown as typeof WebSocket;
  const chromeStub = globalThis.chrome as unknown as Record<string, unknown>;
  chromeStub.alarms = {
    create: (name: string) => {
      alarmCalls.created.push(name);
      return Promise.resolve();
    },
    clear: (name: string) => {
      alarmCalls.cleared.push(name);
      return Promise.resolve();
    },
    onAlarm: { addListener: () => {} },
  };
});

/** Lets reconcile's awaited storage read and alarm calls settle. */
const settle = () => vi.advanceTimersByTimeAsync(0);

describe("BridgeSocket", () => {
  it("costs nothing at all while the bridge is switched off", async () => {
    await bridgeItem.set({ enabled: false, port: 17_836 });
    new BridgeSocket(
      () => {},
      () => {},
    ).start();
    await settle();

    expect(alarmCalls.cleared).toContain("tabrunner-bridge");
    expect(alarmCalls.created).toEqual([]);
    expect(FakeSocket.instances).toHaveLength(0);
  });

  it("arms the reconcile alarm and dials the daemon when enabled", async () => {
    await bridgeItem.set({ enabled: true, port: 4_242 });
    new BridgeSocket(
      () => {},
      () => {},
    ).start();
    await settle();

    expect(alarmCalls.created).toEqual(["tabrunner-bridge"]);
    expect(FakeSocket.instances[0]?.url).toBe("ws://127.0.0.1:4242/ws");
  });

  it("does not fast-retry a connection that never opened", async () => {
    new BridgeSocket(
      () => {},
      () => {},
    ).start();
    await settle();
    FakeSocket.instances[0]?.refuse();

    // No daemon is listening. A 2s retry here would loop forever and hold the
    // service worker awake — the 30s alarm is the only thing allowed to retry.
    await vi.advanceTimersByTimeAsync(10_000);
    expect(FakeSocket.instances).toHaveLength(1);
  });

  it("fast-retries a link that was established and then dropped", async () => {
    new BridgeSocket(
      () => {},
      () => {},
    ).start();
    await settle();
    FakeSocket.instances[0]?.open();
    FakeSocket.instances[0]?.close();

    // A daemon restart is worth catching in seconds, not on the next alarm.
    await vi.advanceTimersByTimeAsync(2_500);
    expect(FakeSocket.instances).toHaveLength(2);
  });

  it("mirrors the link state for UI contexts: up on open, down on close", async () => {
    new BridgeSocket(
      () => {},
      () => {},
    ).start();
    await settle();
    expect(await bridgeConnected.get()).toBe(false);

    FakeSocket.instances[0]?.open();
    await settle();
    expect(await bridgeConnected.get()).toBe(true);

    FakeSocket.instances[0]?.close();
    await settle();
    expect(await bridgeConnected.get()).toBe(false);
  });

  it("reports the link as down when the bridge is switched off", async () => {
    // A link was up before the user switched the bridge off; the boot reconcile
    // is what stands for the config-change watch here (the storage mock's watch
    // is a no-op).
    await bridgeConnected.set(true);
    await bridgeItem.set({ enabled: false, port: 17_836 });
    new BridgeSocket(
      () => {},
      () => {},
    ).start();
    await settle();

    expect(await bridgeConnected.get()).toBe(false);
  });
});

describe("validBridgePort", () => {
  it("accepts userland ports, rejects system ports and nonsense", () => {
    expect(validBridgePort(17_836)).toBe(true);
    expect(validBridgePort(1024)).toBe(true);
    expect(validBridgePort(65_535)).toBe(true);
    expect(validBridgePort(80)).toBe(false);
    expect(validBridgePort(70_000)).toBe(false);
    expect(validBridgePort(17_836.5)).toBe(false);
  });
});
