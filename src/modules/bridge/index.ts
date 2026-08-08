import { Bridge } from "./bridge";

let bridge: Bridge | null = null;

/**
 * Called once per worker boot, synchronously — the bridge registers MV3 event
 * listeners, which Chrome only honours in the worker's first evaluation turn.
 */
export function startBridge(): void {
  if (bridge) return;
  bridge = new Bridge();
  bridge.start();
}
