import { createLogger } from "@/lib/logger";
import { defineItem } from "@/lib/storage";
import type { DaemonMessage, ExtensionMessage } from "./protocol";

const log = createLogger("bridge");

/** Bridge config — on by default; the port must match what `bun run bridge` listens on. */
export const bridgeItem = defineItem<{ enabled: boolean; port: number }>("bridge", {
  enabled: true,
  port: 17_836,
});

/**
 * Outbound WS to the local daemon — the only place WebSocket lives. The worker
 * cannot listen on a socket, so this is always a client; the daemon accepts and
 * makes requests. A 30s alarm (Chrome's minimum period) reconciles the link: it
 * wakes a suspended service worker and doubles as the heartbeat that keeps it
 * from suspending in the first place — mirroring Kimi's reconcile cadence.
 *
 * `start()` is synchronous on purpose: an MV3 worker only receives events whose
 * listeners were registered in the first turn after the script evaluates, so
 * registering the alarm handler behind an `await` would silently forfeit the
 * wake-ups this class exists for. Config is read at connect time instead —
 * which also means toggling the bridge off, or moving its port, takes effect on
 * the next reconcile without a worker restart.
 */
export class BridgeSocket {
  private ws: WebSocket | null = null;
  /** Set across the async config read so two reconciles can't open two sockets. */
  private connecting = false;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly alarm = "regentry-bridge";

  constructor(
    private readonly onMessage: (msg: DaemonMessage) => void,
    private readonly onOpen: () => void,
  ) {}

  start(): void {
    chrome.alarms.create(this.alarm, { periodInMinutes: 0.5 });
    chrome.alarms.onAlarm.addListener((alarm) => {
      if (alarm.name !== this.alarm) return;
      // Heartbeat keeps the worker alive; a dead socket gets reconnected.
      if (this.ws?.readyState === WebSocket.OPEN) this.send({ type: "pong" });
      else void this.connect();
    });
    void this.connect();
  }

  /** Best-effort send — a dead socket silently drops it; the alarm retries. */
  send(msg: ExtensionMessage): void {
    if (this.ws?.readyState !== WebSocket.OPEN) return;
    try {
      this.ws.send(JSON.stringify(msg));
    } catch (e) {
      log.debug("ws send failed:", e instanceof Error ? e.message : String(e));
    }
  }

  private async connect(): Promise<void> {
    if (this.ws || this.connecting) return;
    this.connecting = true;
    try {
      const { enabled, port } = await bridgeItem.get();
      if (!enabled) return;
      const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
      this.ws = ws;
      ws.onopen = () => {
        log.info("bridge connected");
        this.onOpen();
      };
      ws.onmessage = (e) => {
        try {
          this.onMessage(JSON.parse(String(e.data)) as DaemonMessage);
        } catch {
          log.debug("bridge ws bad frame");
        }
      };
      ws.onclose = () => {
        this.ws = null;
        log.debug("bridge ws closed");
        this.scheduleReconnect();
      };
      ws.onerror = () => ws.close();
    } catch {
      // No daemon listening — the alarm reconciles later. Not an error state:
      // the bridge is optional and most users never run the daemon at all.
    } finally {
      this.connecting = false;
    }
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer) return;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      void this.connect();
    }, 2_000);
  }
}
