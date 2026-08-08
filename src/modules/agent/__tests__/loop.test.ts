import { describe, it, expect } from "vitest";
import { runAgentLoop } from "../loop";
import { i18n } from "@/i18n";
import type { BrowserDriver } from "@/modules/browser";
import type { SnapshotResult } from "@/modules/browser/snapshot";
import type { ChatMessage, ChatProvider } from "@/modules/providers/types";

// Storage stand-in and i18n come from src/test-setup.ts (vitest setupFiles).

// Tests: one-method stand-in — the loop only ever calls snapshot() on this path.
const driver = {
  snapshot: async (): Promise<SnapshotResult> => ({
    pageContent: "Page with a button [ref=e1]",
    viewport: { width: 800, height: 600 },
    url: "https://example.com",
    title: "Example",
  }),
} as unknown as BrowserDriver;

/** Streams a single `done` tool call so the loop ends after one step. */
function providerThatEndsWithDone(captured: { messages?: ChatMessage[] }): ChatProvider {
  return {
    async *stream(messages) {
      captured.messages = messages;
      yield { type: "tool_use", id: "c1", name: "done", args: { summary: "ok" } };
      yield { type: "done" };
    },
  };
}

describe("runAgentLoop image handling", () => {
  it("strips user-attached images before they reach a text-only provider", async () => {
    const captured: { messages?: ChatMessage[] } = {};
    const steps: { tool: string; summary?: string }[] = [];
    await runAgentLoop({
      provider: providerThatEndsWithDone(captured),
      driver,
      task: "Check the screenshot [Image #1]",
      images: ["data:image/jpeg;base64,AAAA"],
      supportsImages: false,
      signal: new AbortController().signal,
      callbacks: { onStep: (s) => steps.push(s) },
    });

    const taskMessage = captured.messages?.find((m) => m.role === "user");
    expect(taskMessage?.images).toBeUndefined();
    // The drop is an informational step, not an error that stops the run.
    expect(steps[0]).toEqual({ tool: "warn", summary: i18n.t("errors.textOnlyImages") });
  });

  it("keeps user-attached images for image-capable providers", async () => {
    const captured: { messages?: ChatMessage[] } = {};
    await runAgentLoop({
      provider: providerThatEndsWithDone(captured),
      driver,
      task: "Check the screenshot [Image #1]",
      images: ["data:image/jpeg;base64,AAAA"],
      signal: new AbortController().signal,
      callbacks: {},
    });

    const taskMessage = captured.messages?.find((m) => m.role === "user");
    expect(taskMessage?.images).toEqual(["data:image/jpeg;base64,AAAA"]);
  });
});
