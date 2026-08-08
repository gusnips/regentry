import { describe, it, expect } from "vitest";
import { recallStep, sentMessages } from "../ui/history-recall";
import type { Message } from "../types";

let seq = 0;
function msg(role: Message["role"], content: string): Message {
  seq += 1;
  return { id: `m${seq}`, role, content, timestamp: seq };
}

describe("sentMessages", () => {
  it("takes user messages newest first, ignoring everything else", () => {
    expect(
      sentMessages([
        msg("user", "first"),
        msg("step", "Clicked"),
        msg("assistant", "done"),
        msg("user", "second"),
      ]),
    ).toEqual(["second", "first"]);
  });

  it("collapses consecutive repeats so ↑↑ moves back two messages", () => {
    expect(sentMessages([msg("user", "a"), msg("user", "go"), msg("user", "go")])).toEqual([
      "go",
      "a",
    ]);
  });

  it("skips blank content — a whitespace draft is not history", () => {
    expect(sentMessages([msg("user", "  "), msg("user", "real")])).toEqual(["real"]);
  });
});

describe("recallStep", () => {
  const history = ["newest", "middle", "oldest"];

  it("walks back with ↑ from an empty composer", () => {
    expect(recallStep("ArrowUp", null, "", history)).toEqual({ index: 0, text: "newest" });
    expect(recallStep("ArrowUp", 0, "newest", history)).toEqual({ index: 1, text: "middle" });
  });

  it("holds at the oldest instead of wrapping", () => {
    expect(recallStep("ArrowUp", 2, "oldest", history)).toBeNull();
  });

  it("↓ walks forward and out to the empty draft", () => {
    expect(recallStep("ArrowDown", 1, "middle", history)).toEqual({ index: 0, text: "newest" });
    expect(recallStep("ArrowDown", 0, "newest", history)).toEqual({ index: null, text: "" });
  });

  it("leaves the caret alone mid-draft — arrows only recall on an empty composer", () => {
    expect(recallStep("ArrowUp", null, "half-typed", history)).toBeNull();
    expect(recallStep("ArrowDown", null, "", history)).toBeNull();
  });

  it("keeps browsing once started, however long the recalled text is", () => {
    // The recalled text fills the composer; the next ↑ must still step back.
    expect(recallStep("ArrowUp", 1, "middle", history)).toEqual({ index: 2, text: "oldest" });
  });

  it("starts over from the newest whenever the composer is empty", () => {
    // Switching conversations empties the composer while the position stands —
    // resuming it would recall a message from the transcript you just left.
    expect(recallStep("ArrowUp", 2, "", history)).toEqual({ index: 0, text: "newest" });
  });

  it("does nothing when there is no history yet", () => {
    expect(recallStep("ArrowUp", null, "", [])).toBeNull();
  });
});
