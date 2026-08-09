import { describe, expect, it } from "vitest";

import { formatTranscriptWindow } from "../read-history";
import type { Message } from "@/modules/conversation/types";

let seq = 0;
const msg = (role: Message["role"], content: string, extra?: Partial<Message>): Message => ({
  id: `m${seq}`,
  role,
  content,
  timestamp: seq++,
  ...extra,
});

describe("formatTranscriptWindow", () => {
  it("reports an empty transcript instead of a blank log", () => {
    const window = formatTranscriptWindow([], {});
    expect(window).toMatchObject({ total: 0, from: 0, to: 0 });
    expect(window.log).toBe("No transcript entries yet.");
  });

  it("drops reasoning and run-internal chatter, numbering what remains", () => {
    const window = formatTranscriptWindow(
      [
        msg("user", "find flights"),
        msg("reasoning", "let me think"),
        msg("step", "Connection hiccup — retrying (1/2)", { tool: "retry" }),
        msg("step", "Navigated successfully", { tool: "navigate", args: { url: "https://reddit.com" } }),
        msg("error", "Provider error: 429"),
        msg("assistant", "I need to continue"),
      ],
      {},
    );

    expect(window.total).toBe(4);
    expect(window.log).toContain("#0 user — find flights");
    expect(window.log).toContain("#1 step navigate · reddit.com — Navigated successfully");
    expect(window.log).toContain("#2 error — Provider error: 429");
    expect(window.log).toContain("#3 assistant — I need to continue");
  });

  it("defaults to the newest window", () => {
    const messages = Array.from({ length: 50 }, (_, i) => msg("assistant", `turn ${i}`));
    const window = formatTranscriptWindow(messages, {});

    expect(window).toMatchObject({ total: 50, from: 10, to: 50 });
    expect(window.log).toContain("#10");
    expect(window.log).not.toContain("#9 ");
  });

  it("pages by absolute index", () => {
    const messages = Array.from({ length: 50 }, (_, i) => msg("assistant", `turn ${i}`));
    const window = formatTranscriptWindow(messages, { from: 0, limit: 5 });

    expect(window).toMatchObject({ from: 0, to: 5 });
    expect(window.log).toContain("#0 assistant — turn 0");
    expect(window.log).toContain("#4 assistant — turn 4");
    expect(window.log).not.toContain("#5");
  });

  it("includes step details only on request", () => {
    const messages = [
      msg("step", "Captured 154 elements", {
        tool: "snapshot",
        detail: 'button "Submit" [ref=e3]',
      }),
    ];

    expect(formatTranscriptWindow(messages, {}).log).not.toContain("Submit");
    expect(formatTranscriptWindow(messages, { includeDetails: true }).log).toContain(
      "↳ button \"Submit\" [ref=e3]",
    );
  });

  it("marks failed steps", () => {
    const window = formatTranscriptWindow(
      [msg("step", "Failed: element not found", { tool: "click", ok: false, args: { ref: "e9" } })],
      {},
    );
    expect(window.log).toContain("#0 step click · e9 ✗ — Failed: element not found");
  });

  it("cuts an oversized window short and marks where to continue", () => {
    const big = "x".repeat(1000);
    const messages = Array.from({ length: 200 }, () => msg("assistant", big));
    const window = formatTranscriptWindow(messages, {});

    expect(window.from).toBe(160);
    expect(window.to).toBeLessThan(200);
    expect(window.log.split("\n")).toHaveLength(window.to - window.from);
  });
});
