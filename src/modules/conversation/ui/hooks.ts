import { useEffect, useState } from "react";
import { useConversationStore } from "./store";

/**
 * Ticking Date.now() for duration displays ("for 3m 48s"). Runs one interval
 * only while active — idle transcripts pay no timer.
 */
export function useNow(active: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [active]);
  return now;
}

/**
 * May the panel walk away from the run right now? The plan gate must be behind
 * the run — before that the panel is the only place the approval can be
 * answered, and closing strands it on an OS notification the user has to click
 * their way back from. A panel reopened mid-run missed the handshake, so the
 * transcript stands in: a plan card from THIS run (its timestamp keeps a
 * previous run's card from passing) means the gate is past. Parked states (an
 * armed approval here, the board's "awaiting" mark) answer no outright. The
 * run-target toggle's mid-run flip consumes this; idle — no live run at all —
 * is never ready, however many old plan cards the transcript holds.
 */
export function useWalkAwayReady(): boolean {
  const status = useConversationStore((s) => s.status);
  const runStartedAt = useConversationStore((s) => s.runStartedAt);
  const bridgeActive = useConversationStore((s) => s.bridgeActive);
  const planApproved = useConversationStore((s) => s.planApproved);
  const awaitingApproval = useConversationStore((s) => s.planApproval !== null);
  // Selecting only the plan message (reference-stable until rewritten) keeps
  // this from re-rendering on every unrelated message churn mid-run.
  const plan = useConversationStore((s) => s.messages.findLast((m) => m.role === "plan"));
  const boardRun = useConversationStore((s) =>
    s.activeId !== null && s.board.running?.conversationId === s.activeId
      ? s.board.running
      : undefined,
  );

  // This panel's own run when it has one; the board's record of the run it
  // reopened into otherwise — but never a bridge session's: that client owns
  // the run, and the toggle's flip is not the walk-away there.
  const localLive = status === "running" && runStartedAt !== null;
  const liveStartedAt = localLive
    ? runStartedAt
    : !bridgeActive && boardRun
      ? boardRun.startedAt
      : null;
  if (liveStartedAt === null) return false;
  if (awaitingApproval || boardRun?.awaiting === true) return false;
  return localLive ? planApproved : plan !== undefined && plan.timestamp >= liveStartedAt;
}
