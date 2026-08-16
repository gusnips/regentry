import { defineItem } from "@/lib/storage";

/**
 * Bridge config — off by default: almost nobody runs an MCP client, and an
 * enabled bridge with no daemon listening pays a failed-WebSocket console
 * error every reconcile, which on a fresh install reads as the extension being
 * broken. Chromium logs a refused socket from the network stack — no JS can
 * silence it — so not dialing is the only clean install. MCP users opt in at
 * Settings → MCP; the port must match what `bun run bridge` listens on. Lives
 * apart from the socket so UI contexts (Settings → MCP) can read and edit it
 * without bundling the WebSocket client.
 */
export const bridgeItem = defineItem<{ enabled: boolean; port: number }>("bridge", {
  enabled: false,
  port: 17_836,
});

/**
 * Whether the daemon link is up right now, mirrored from the socket by the
 * worker so UI contexts can show it over the storage-watch channel — the
 * socket itself is reachable only in the background.
 */
export const bridgeConnected = defineItem<boolean>("bridgeConnected", false);

/**
 * The dedicated MCP thread's id. Stored, not held in the Bridge instance,
 * because the MV3 worker this all lives in is disposable: Chrome suspends it
 * after ~30s idle and destroys it outright on every extension reload and
 * version update. An in-memory id meant the next `run` minted a fresh
 * conversation and the client's thread — the pages it visited, what it found —
 * was gone, with the old transcript orphaned in the user's history. Storage
 * outlives all three, so the thread continues exactly where it left off and
 * `new_conversation` stays the only thing that ends it.
 */
export const bridgeThread = defineItem<string | null>("bridge-conversation", null);

/** Well-known and system ports are never a daemon — userland range only. */
export function validBridgePort(port: number): boolean {
  return Number.isInteger(port) && port >= 1024 && port <= 65_535;
}
