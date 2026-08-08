import { createLogger } from "@/lib/logger";

const log = createLogger("runs");

/** Which client started the run — decides who may stop/steer it and how a
 *  conflict is worded. Only the owner's stop/inject commands touch a run. */
export type RunOwner = "panel" | "bridge";

/** The single live run slot. The injected queue lives here too, so both clients
 *  steer their own runs without any per-port state. */
export interface ActiveRun {
  conversationId: string;
  owner: RunOwner;
  controller: AbortController;
  /** Messages typed mid-run, drained by the loop at each tool boundary. */
  injectedQueue: { id: string; text: string }[];
}

let active: ActiveRun | null = null;

export function getActiveRun(): ActiveRun | null {
  return active;
}

export type AcquireResult = { ok: true; run: ActiveRun } | { ok: false; active: ActiveRun };

/** Claim the single run slot — one agent loop drives one browser at a time,
 *  whatever client asked for it. The conflict carries the holder so the caller
 *  can say where the run is and how to stop it. */
export function acquireRun(conversationId: string, owner: RunOwner): AcquireResult {
  if (active) return { ok: false, active };
  const run: ActiveRun = {
    conversationId,
    owner,
    controller: new AbortController(),
    injectedQueue: [],
  };
  active = run;
  log.debug("run acquired", { conversationId, owner });
  return { ok: true, run };
}

/** Release the slot — but only if the handle is still the current one: a stop
 *  may have already released it and a newer run taken the slot while this one
 *  unwound. */
export function releaseRun(run: ActiveRun): void {
  if (active === run) active = null;
}
