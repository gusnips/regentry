import { defineItem } from "@/lib/storage";

/**
 * Bridge config — on by default; the port must match what `bun run bridge`
 * listens on. Lives apart from the socket so UI contexts (Settings → MCP) can
 * read and edit it without bundling the WebSocket client.
 */
export const bridgeItem = defineItem<{ enabled: boolean; port: number }>("bridge", {
  enabled: true,
  port: 17_836,
});

/**
 * Whether the daemon link is up right now, mirrored from the socket by the
 * worker so UI contexts can show it over the storage-watch channel — the
 * socket itself is reachable only in the background.
 */
export const bridgeConnected = defineItem<boolean>("bridgeConnected", false);

/** Well-known and system ports are never a daemon — userland range only. */
export function validBridgePort(port: number): boolean {
  return Number.isInteger(port) && port >= 1024 && port <= 65_535;
}
