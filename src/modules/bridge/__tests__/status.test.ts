import { describe, it, expect } from "vitest";

import { applyQuestion, applyStatusEvent, emptyStatus, newRunStatus } from "../status";
import { acquireRun, getActiveRun, releaseRun } from "@/modules/agent/active-runs";

describe("bridge status", () => {
  it("accumulates the run the daemon serves to getStatus", () => {
    const status = newRunStatus("conv-1", "run-1");

    expect(applyStatusEvent(status, { type: "token", text: "hi" })).toBeNull(); // never forwarded
    applyStatusEvent(status, { type: "driving", tabId: 7, windowId: 1, title: "Inbox" });
    applyStatusEvent(status, { type: "step", tool: "click", summary: "Clicked Send", ok: true });
    applyStatusEvent(status, { type: "plan", steps: ["find", "send"], current: 1 });
    applyStatusEvent(status, { type: "done", summary: "Sent." });

    expect(status).toMatchObject({
      state: "done",
      summary: "Sent.",
      driving: { tabId: 7, title: "Inbox" },
      steps: [{ tool: "click", summary: "Clicked Send", ok: true }],
      plan: { steps: ["find", "send"], current: 1 },
    });
  });

  it("keeps the question as the closing state — ask_user ends the run with a done too", () => {
    const status = newRunStatus("conv-1", "run-1");
    applyQuestion(status, "Pay the $42 invoice?");
    applyStatusEvent(status, { type: "done", summary: "Waiting on you." });

    expect(status.state).toBe("question");
    expect(status.question).toBe("Pay the $42 invoice?");
  });

  it("an error is terminal and carries what failed", () => {
    const status = newRunStatus("conv-1", "run-1");
    applyStatusEvent(status, { type: "error", message: "No active provider" });

    expect(status).toMatchObject({ state: "error", error: "No active provider" });
    expect(status.finishedAt).not.toBeNull();
  });

  it("starts idle with nothing to report", () => {
    expect(emptyStatus()).toMatchObject({ state: "idle", runId: null, steps: [], question: null });
  });
});

describe("run lock", () => {
  it("admits one run at a time and names the holder to the loser", () => {
    const first = acquireRun("conv-1", "panel");
    expect(first.ok).toBe(true);

    const second = acquireRun("conv-2", "bridge");
    expect(second.ok).toBe(false);
    // The conflict carries the holder so each caller can word it for its audience.
    if (!second.ok) expect(second.active.owner).toBe("panel");

    if (first.ok) releaseRun(first.run);
    expect(getActiveRun()).toBeNull();

    const retry = acquireRun("conv-2", "bridge");
    expect(retry.ok).toBe(true);
    if (retry.ok) releaseRun(retry.run);
  });

  it("a stale handle can't release the run that replaced it", () => {
    const stale = acquireRun("conv-1", "panel");
    if (!stale.ok) throw new Error("expected the slot");
    releaseRun(stale.run);

    const current = acquireRun("conv-2", "bridge");
    releaseRun(stale.run); // the old run unwinding, long after losing the slot

    expect(getActiveRun()).toBe(current.ok ? current.run : null);
    if (current.ok) releaseRun(current.run);
  });
});
