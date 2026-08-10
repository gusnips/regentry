import { defineItem } from "@/lib/storage";
import { createLogger, truncate } from "@/lib/logger";
import { getActiveRun, onRunReleased } from "./active-runs";
import type { RunOwner } from "./active-runs";

const log = createLogger("runs");

/**
 * The serial run queue on top of the single run slot. One run drives at a time
 * (one CDP target, one browser), everything else waits FIFO. Callers hand in a
 * `launch` closure — the exact call they would have made for an immediate start
 * — so a queued run is indistinguishable from an immediate one once it starts,
 * and ownership (who may stop or steer it) never changes hands.
 *
 * Every transition is mirrored to `runBoardItem`, the ambient "what is TabRunner
 * doing" record: the floating widget, the panel's run board, and the toolbar
 * badge read it over storage watch, the MCP bridge forwards it as compact
 * events — no new port plumbing anywhere.
 */

/** One queued submission, as the UI and the bridge protocol see it. */
export interface QueuedRun {
  id: string;
  conversationId: string;
  owner: RunOwner;
  task: string;
  enqueuedAt: number;
}

interface QueueEntry extends QueuedRun {
  /** Starts the run exactly as its owner's immediate path would. */
  launch: () => void;
}

/** The ambient run state every surface reads. */
export interface RunBoard {
  running?: {
    conversationId: string;
    task: string;
    owner: RunOwner;
    tabId?: number;
    /** Parked on the user's answer (plan approval) — alive, but not working. */
    awaiting?: boolean;
  };
  queue: QueuedRun[];
}

export const runBoardItem = defineItem<RunBoard>("run-board", { queue: [] });

const queue: QueueEntry[] = [];
/** The board's view of the active run — set at submit, tab id filled in later. */
let running: RunBoard["running"] | null = null;

export type SubmitOutcome = { started: true } | { queued: number; id: string };

/**
 * Free slot → start now; occupied → wait FIFO. The check and the launch's slot
 * claim are one synchronous turn (launch's first await comes after acquireRun),
 * so the slot can't be taken in between.
 */
export function submitRun(entry: Omit<QueueEntry, "id" | "enqueuedAt">): SubmitOutcome {
  if (!getActiveRun()) {
    running = { conversationId: entry.conversationId, task: entry.task, owner: entry.owner };
    entry.launch();
    void writeBoard();
    return { started: true };
  }
  const queued: QueueEntry = { ...entry, id: crypto.randomUUID(), enqueuedAt: Date.now() };
  queue.push(queued);
  log.info("run queued", {
    position: queue.length,
    owner: entry.owner,
    task: truncate(entry.task, 120),
  });
  void writeBoard();
  return { queued: queue.length, id: queued.id };
}

/** Take a waiting entry out of the line. False when it already left (started). */
export function cancelQueued(id: string): boolean {
  const i = queue.findIndex((q) => q.id === id);
  if (i < 0) return false;
  queue.splice(i, 1);
  void writeBoard();
  return true;
}

export function listQueue(): QueuedRun[] {
  return queue.map((q) => ({
    id: q.id,
    conversationId: q.conversationId,
    owner: q.owner,
    task: q.task,
    enqueuedAt: q.enqueuedAt,
  }));
}

/** The board as it stands — same shape the storage item carries. */
export function currentBoard(): RunBoard {
  return { ...(running ? { running } : {}), queue: listQueue() };
}

/**
 * The running entry's tab — filled in once the run has resolved its target,
 * and again whenever switch_tab re-targets it. No-op for a run that is no
 * longer the board's running entry (a stale unwind must not move the board).
 */
export function markRunningTab(conversationId: string, tabId: number): void {
  if (!running || running.conversationId !== conversationId) return;
  running = { ...running, tabId };
  void writeBoard();
}

/**
 * The running entry parked on the user's answer (plan approval) or got it.
 * Same stale-guard as markRunningTab — a run that already ended must not
 * move the board.
 */
export function markRunningAwaiting(conversationId: string, awaiting: boolean): void {
  if (!running || running.conversationId !== conversationId) return;
  running = { ...running, awaiting };
  void writeBoard();
}

/** In-worker board subscription — the bridge mirrors it into its compact stream. */
export function onBoardChanged(cb: (board: RunBoard) => void): () => void {
  boardListeners.add(cb);
  return () => boardListeners.delete(cb);
}

const boardListeners = new Set<(board: RunBoard) => void>();

async function writeBoard(): Promise<void> {
  const board = currentBoard();
  for (const cb of boardListeners) cb(board);
  await runBoardItem.set(board);
}

// A freed slot starts the next waiter — every end path (done, error, stop,
// driven-tab close) funnels through releaseRun, so they all pump. Launch first,
// board second: the launch rewrites the bridge's status mirror, and the board
// write then lands the queue on top of it.
onRunReleased(() => {
  const next = queue.shift();
  if (!next) {
    running = null;
    void writeBoard();
    return;
  }
  running = { conversationId: next.conversationId, task: next.task, owner: next.owner };
  log.info("queued run starting", {
    owner: next.owner,
    task: truncate(next.task, 120),
  });
  next.launch();
  void writeBoard();
});
