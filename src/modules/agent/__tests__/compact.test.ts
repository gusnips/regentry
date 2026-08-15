import { describe, it, expect } from "vitest";
import { compactRunMessages } from "../compact";
import type { ChatMessage, ChatProvider, Delta } from "@/modules/providers/types";

/** A provider that answers every call with one fixed summary. */
function fakeProvider(summary = "1. Task: book a flight\n2. Findings: seat 4A held"): ChatProvider {
  return {
    async *stream(): AsyncIterable<Delta> {
      yield { type: "text", text: summary };
      yield { type: "done" };
    },
  };
}

/** A run's wire conversation: system, task, then N assistant/tool_results pairs. */
function runMessages(pairs: number): ChatMessage[] {
  const messages: ChatMessage[] = [
    { role: "system", content: "sys" },
    { role: "user", content: "book a flight" },
  ];
  for (let i = 0; i < pairs; i++) {
    messages.push({
      role: "assistant",
      content: `turn ${i}`,
      toolCalls: [{ id: `c${i}`, name: "click", args: {} }],
    });
    messages.push({
      role: "tool_results",
      content: "",
      toolResults: [{ id: `c${i}`, content: `result ${i}` }],
    });
  }
  return messages;
}

describe("compactRunMessages", () => {
  it("folds the middle into the task and keeps the wire alternating", async () => {
    const messages = runMessages(10);
    const removed = await compactRunMessages(
      fakeProvider(),
      messages,
      1,
      "book a flight",
      new AbortController().signal,
    );

    expect(removed).toBeGreaterThan(0);
    expect(messages.length).toBe(22 - removed);
    // The summary rides on the task message — never as a turn of its own, which
    // would put two same-role turns back to back and 400 on Anthropic.
    expect(messages[1]?.role).toBe("user");
    expect(messages[1]?.content).toContain("book a flight");
    expect(messages[1]?.content).toContain("seat 4A held");
    // What survives the fold must start on an assistant turn: a tool_results
    // block whose assistant was folded away orphans its tool_use id.
    expect(messages[2]?.role).toBe("assistant");
  });

  it("never splits a tool call from its result", async () => {
    const messages = runMessages(12);
    await compactRunMessages(
      fakeProvider(),
      messages,
      1,
      "book a flight",
      new AbortController().signal,
    );

    const open = new Set<string>();
    for (const m of messages) {
      for (const call of m.toolCalls ?? []) open.add(call.id);
      for (const result of m.toolResults ?? []) {
        expect(open.has(result.id)).toBe(true);
        open.delete(result.id);
      }
    }
    expect([...open]).toEqual([]);
  });

  it("rebuilds the note from the original task, so a second pass never nests summaries", async () => {
    const messages = runMessages(10);
    const signal = new AbortController().signal;
    await compactRunMessages(fakeProvider("first summary"), messages, 1, "book a flight", signal);
    for (let i = 0; i < 8; i++) {
      messages.push({ role: "assistant", content: "more", toolCalls: [] });
      messages.push({ role: "tool_results", content: "", toolResults: [] });
    }
    await compactRunMessages(fakeProvider("second summary"), messages, 1, "book a flight", signal);

    const task = messages[1]?.content ?? "";
    expect(task).toContain("second summary");
    expect(task).not.toContain("first summary");
    // One note, not a stack of them.
    expect(task.match(/<progress_so_far>/g)?.length).toBe(1);
  });

  it("does nothing when there is no whole turn to fold", async () => {
    const messages = runMessages(2);
    const removed = await compactRunMessages(
      fakeProvider(),
      messages,
      1,
      "book a flight",
      new AbortController().signal,
    );
    expect(removed).toBe(0);
    expect(messages.length).toBe(6);
  });
});

describe("summarizer input bounds", () => {
  it("trims its own input, so compaction never fails for the reason it was called", async () => {
    let seen = "";
    const provider: ChatProvider = {
      async *stream(messages): AsyncIterable<Delta> {
        seen = messages.map((m) => m.content).join("");
        yield { type: "text", text: "summary" };
        yield { type: "done" };
      },
    };

    // Each result is already truncated per-entry when rendered, so the size
    // that defeats a summarizer is MANY turns, not one huge one — a long run
    // of page snapshots, which is exactly what overflows a window.
    const messages = runMessages(40);
    for (const m of messages) {
      for (const result of m.toolResults ?? []) result.content = "x".repeat(20_000);
    }
    await compactRunMessages(provider, messages, 1, "task", new AbortController().signal);

    expect(seen.length).toBeLessThan(100_000);
    expect(seen).toContain("earlier turns omitted");
  });
});
