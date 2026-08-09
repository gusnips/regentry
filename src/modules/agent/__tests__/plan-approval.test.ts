import { describe, it, expect } from "vitest";
import { runAgentLoop, planNeedsReapproval } from "../loop";
import { i18n } from "@/i18n";
import type { BrowserDriver } from "@/modules/browser";
import type { SnapshotResult } from "@/modules/browser/snapshot";
import type { ChatMessage, ChatProvider, ToolCall } from "@/modules/providers/types";
import type { PlanPayload } from "@/shared/protocol";

// Storage stand-in and i18n come from src/test-setup.ts (vitest setupFiles).

const snapshot = async (): Promise<SnapshotResult> => ({
  pageContent: "Page with a button [ref=e1]",
  viewport: { width: 800, height: 600 },
  url: "https://example.com",
  title: "Example",
});

/** Driver stand-in — every method resolves a benign success; navigate/click record their use. */
function makeDriver(calls: string[] = []): BrowserDriver {
  return {
    snapshot,
    navigate: async () => {
      calls.push("navigate");
    },
    click: async () => {
      calls.push("click");
      return { x: 1, y: 2 };
    },
  } as unknown as BrowserDriver;
}

/** Streams one scripted tool call per turn, in order, then done. */
function scriptedProvider(script: ToolCall[][]): ChatProvider {
  let turn = 0;
  return {
    async *stream() {
      const calls = script[turn++] ?? [{ id: "done", name: "done", args: { summary: "ok" } }];
      for (const call of calls) yield { type: "tool_use", ...call };
      yield { type: "done" };
    },
  };
}

const call = (name: string, args: Record<string, unknown> = {}): ToolCall => ({
  id: `c-${name}`,
  name,
  args,
});

const planCall = (steps: string[], current = 0): ToolCall => call("plan", { steps, current });

describe("planNeedsReapproval", () => {
  const approved: PlanPayload = { steps: ["a", "b", "c"], current: 0 };

  it("does not re-ask when only progress advances", () => {
    expect(planNeedsReapproval(approved, { steps: ["a", "b", "c"], current: 2 })).toBe(false);
  });

  it("re-asks when an upcoming step is new", () => {
    expect(planNeedsReapproval(approved, { steps: ["a", "b", "d"], current: 1 })).toBe(true);
  });

  it("re-asks when an upcoming step is reworded", () => {
    expect(planNeedsReapproval(approved, { steps: ["a", "b", "C"], current: 1 })).toBe(true);
  });

  it("does not re-ask when upcoming work only shrinks", () => {
    expect(planNeedsReapproval(approved, { steps: ["a", "b"], current: 1 })).toBe(false);
  });

  it("ignores edits to finished steps", () => {
    expect(planNeedsReapproval(approved, { steps: ["A!", "b", "c"], current: 1 })).toBe(false);
  });
});

describe("runAgentLoop plan approval gate", () => {
  it("blocks an action tool called before any plan is approved", async () => {
    const calls: string[] = [];
    // Turn 1: model jumps straight to navigate — gate bounces it. Turn 2: it plans.
    const provider = scriptedProvider([
      [call("navigate", { url: "https://x.com" })],
      [planCall(["Go to X", "Read X"])],
    ]);
    const wire: ChatMessage[] = await runAgentLoop({
      provider,
      driver: makeDriver(calls),
      task: "go to x",
      signal: new AbortController().signal,
      callbacks: {},
    });

    expect(calls).toEqual([]); // navigate never executed
    // The bounced call's tool result tells the model how to unblock itself.
    const results = wire.find((m) => m.role === "tool_results")?.toolResults ?? [];
    expect(results[0]?.content).toContain(i18n.t("errors.planGateModel"));
  });

  it("parks on the first plan, then runs actions once approved", async () => {
    const calls: string[] = [];
    const approvals: { steps: string[]; reapproval: boolean }[] = [];
    const provider = scriptedProvider([
      [planCall(["Go to X", "Read X"])],
      [call("navigate", { url: "https://x.com" })],
    ]);
    await runAgentLoop({
      provider,
      driver: makeDriver(calls),
      task: "go to x",
      signal: new AbortController().signal,
      callbacks: {
        onPlanApproval: async (steps, reapproval) => {
          approvals.push({ steps, reapproval });
          return { approved: true };
        },
      },
    });

    expect(approvals).toEqual([{ steps: ["Go to X", "Read X"], reapproval: false }]);
    expect(calls).toEqual(["navigate"]);
  });

  it("ends the run with the rejection summary when the plan is rejected", async () => {
    const calls: string[] = [];
    const summaries: (string | undefined)[] = [];
    const provider = scriptedProvider([[planCall(["Delete everything"])], [call("click")]]);
    await runAgentLoop({
      provider,
      driver: makeDriver(calls),
      task: "delete my account",
      signal: new AbortController().signal,
      callbacks: {
        onPlanApproval: async () => ({ approved: false }),
        onDone: (summary) => summaries.push(summary),
      },
    });

    expect(summaries).toEqual([i18n.t("errors.planRejected")]);
    expect(calls).toEqual([]); // nothing after the rejected plan ran
  });

  it("sends a rejected plan back with the revision note and re-asks the revised plan", async () => {
    const calls: string[] = [];
    const approvals: { steps: string[]; reapproval: boolean }[] = [];
    const provider = scriptedProvider([
      [planCall(["Go to X", "Buy the thing"])],
      [planCall(["Go to X", "Read X"])], // the revised plan
      [call("navigate", { url: "https://x.com" })],
    ]);
    const wire: ChatMessage[] = await runAgentLoop({
      provider,
      driver: makeDriver(calls),
      task: "go to x",
      signal: new AbortController().signal,
      callbacks: {
        onPlanApproval: async (steps, reapproval) => {
          approvals.push({ steps, reapproval });
          return approvals.length === 1
            ? { approved: false, feedback: "Do not buy anything" }
            : { approved: true };
        },
      },
    });

    // Both plans were asked about; the revision re-ask is a fresh first ask.
    expect(approvals).toEqual([
      { steps: ["Go to X", "Buy the thing"], reapproval: false },
      { steps: ["Go to X", "Read X"], reapproval: false },
    ]);
    // The note rode back in the first plan's own tool result.
    const results = wire.find((m) => m.role === "tool_results")?.toolResults ?? [];
    expect(results[0]?.content).toContain("Do not buy anything");
    // The gate re-armed between plans: nothing ran until the revised approval.
    expect(calls).toEqual(["navigate"]);
  });

  it("treats a blank revision note as a plain rejection", async () => {
    const summaries: (string | undefined)[] = [];
    const provider = scriptedProvider([[planCall(["Delete everything"])], [call("click")]]);
    await runAgentLoop({
      provider,
      driver: makeDriver(),
      task: "delete my account",
      signal: new AbortController().signal,
      callbacks: {
        onPlanApproval: async () => ({ approved: false, feedback: "   " }),
        onDone: (summary) => summaries.push(summary),
      },
    });

    expect(summaries).toEqual([i18n.t("errors.planRejected")]);
  });

  it("does not re-ask when a plan update only advances progress", async () => {
    const approvals: { steps: string[]; reapproval: boolean }[] = [];
    const provider = scriptedProvider([
      [planCall(["Go to X", "Read X"])],
      [planCall(["Go to X", "Read X"], 1)],
    ]);
    await runAgentLoop({
      provider,
      driver: makeDriver(),
      task: "go to x",
      signal: new AbortController().signal,
      callbacks: {
        onPlanApproval: async (steps, reapproval) => {
          approvals.push({ steps, reapproval });
          return { approved: true };
        },
      },
    });

    expect(approvals).toHaveLength(1); // only the first proposal asked
  });

  it("re-asks when a mid-run replan changes the upcoming steps", async () => {
    const calls: string[] = [];
    const approvals: { steps: string[]; reapproval: boolean }[] = [];
    const provider = scriptedProvider([
      [planCall(["Go to X", "Read X"])],
      [call("navigate", { url: "https://x.com" })],
      [planCall(["Go to X", "Buy the thing"], 1)], // deviation — must re-ask
      [call("click")],
    ]);
    await runAgentLoop({
      provider,
      driver: makeDriver(calls),
      task: "go to x",
      signal: new AbortController().signal,
      callbacks: {
        onPlanApproval: async (steps, reapproval) => {
          approvals.push({ steps, reapproval });
          return { approved: true };
        },
      },
    });

    expect(approvals).toEqual([
      { steps: ["Go to X", "Read X"], reapproval: false },
      { steps: ["Go to X", "Buy the thing"], reapproval: true },
    ]);
    expect(calls).toEqual(["navigate", "click"]);
  });

  it("auto-approves when no onPlanApproval callback is wired", async () => {
    const calls: string[] = [];
    const provider = scriptedProvider([
      [planCall(["Go to X"])],
      [call("navigate", { url: "https://x.com" })],
    ]);
    await runAgentLoop({
      provider,
      driver: makeDriver(calls),
      task: "go to x",
      signal: new AbortController().signal,
      callbacks: {},
    });

    expect(calls).toEqual(["navigate"]);
  });
});
