import { describe, it, expect } from "vitest";

import { TranscriptWriter } from "../transcript";
import { appendMessageTo, listConversations } from "../conversations";
import type { Event } from "@/shared/protocol";
import type { Message } from "../types";

/**
 * Same settle trick as transcript.test.ts: the writer records fire-and-forget
 * through the serialized storage chain, and the in-memory storage stub settles
 * in microtasks — one macrotask turn drains every queued write.
 */
const settled = () => new Promise((resolve) => setTimeout(resolve, 0));

async function replay(id: string, events: Event[]) {
  const writer = new TranscriptWriter(id);
  events.forEach((e) => writer.apply(e));
  await settled();
}

const lastRunOf = async (id: string) =>
  (await listConversations()).find((c) => c.id === id)?.lastRun;

describe("last-run summary", () => {
  it("stamps the conversation with the run's span and tokens when it ends", async () => {
    await replay("run-sum", [
      { type: "usage", input: 10, output: 4 },
      { type: "usage", input: 5, output: 2 },
      { type: "done", summary: "All set." },
    ]);

    const lastRun = await lastRunOf("run-sum");
    if (!lastRun) throw new Error("summary not recorded");
    expect(lastRun).toMatchObject({ input: 15, output: 6 });
    expect(lastRun.endedAt).toBeGreaterThanOrEqual(lastRun.startedAt);
  });

  it("stamps an error end too — the band settles the same either way", async () => {
    await replay("run-err-sum", [{ type: "error", message: "Provider error: 429" }]);
    expect(await lastRunOf("run-err-sum")).toBeDefined();
  });

  it("stamps a run that ended on a question — the band says waiting, not done", async () => {
    await replay("run-q-sum", [
      { type: "step", tool: "ask_user", summary: "Which invoice?" },
      { type: "done", question: true },
    ]);
    expect(await lastRunOf("run-q-sum")).toBeDefined();
  });

  it("is retired by the next user message", async () => {
    await replay("run-clear", [{ type: "done", summary: "Done." }]);
    expect(await lastRunOf("run-clear")).toBeDefined();

    await appendMessageTo("run-clear", {
      id: crypto.randomUUID(),
      role: "user",
      content: "and now something else",
      timestamp: Date.now(),
    });
    expect(await lastRunOf("run-clear")).toBeUndefined();
  });

  it("survives run-internal appends — only a fresh task retires it", async () => {
    await replay("run-keep", [{ type: "done", summary: "Done." }]);
    const breadcrumb: Message = {
      id: crypto.randomUUID(),
      role: "step",
      tool: "interrupted",
      content: "The run was cancelled",
      timestamp: Date.now(),
    };
    await appendMessageTo("run-keep", breadcrumb);
    expect(await lastRunOf("run-keep")).toBeDefined();
  });
});
