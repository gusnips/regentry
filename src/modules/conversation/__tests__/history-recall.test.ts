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
  /** Composer state, caret at the end of the text unless a test says otherwise. */
  const at = (index: number | null, text: string, draft = "", caret = text.length) => ({
    index,
    text,
    caret,
    draft,
  });

  it("walks back with ↑ from an empty composer", () => {
    expect(recallStep("ArrowUp", history, at(null, ""))).toEqual({
      index: 0,
      text: "newest",
      draft: "",
    });
    expect(recallStep("ArrowUp", history, at(0, "newest"))).toEqual({
      index: 1,
      text: "middle",
      draft: "",
    });
  });

  it("holds at the oldest instead of wrapping", () => {
    expect(recallStep("ArrowUp", history, at(2, "oldest"))).toBeNull();
  });

  it("↑ browses from a filled composer and ↓ hands the draft back", () => {
    const started = recallStep("ArrowUp", history, at(null, "half-typed"));
    expect(started).toEqual({ index: 0, text: "newest", draft: "half-typed" });
    expect(recallStep("ArrowDown", history, at(0, "newest", "half-typed"))).toEqual({
      index: null,
      text: "half-typed",
      draft: "half-typed",
    });
  });

  it("↓ walks forward and out to the empty draft", () => {
    expect(recallStep("ArrowDown", history, at(1, "middle"))).toEqual({
      index: 0,
      text: "newest",
      draft: "",
    });
    expect(recallStep("ArrowDown", history, at(0, "newest"))).toEqual({
      index: null,
      text: "",
      draft: "",
    });
  });

  it("leaves the caret alone inside a multi-line draft", () => {
    // ↑ from the second line moves up a line; ↓ from the first moves down one.
    expect(recallStep("ArrowUp", history, at(null, "one\ntwo"))).toBeNull();
    expect(recallStep("ArrowDown", history, at(null, "one\ntwo", "", 1))).toBeNull();
    // …but the edge lines still recall.
    expect(recallStep("ArrowUp", history, at(null, "one\ntwo", "", 1))).toEqual({
      index: 0,
      text: "newest",
      draft: "one\ntwo",
    });
  });

  it("↓ on a fresh draft is not a recall", () => {
    expect(recallStep("ArrowDown", history, at(null, ""))).toBeNull();
  });

  it("keeps browsing once started, however long the recalled text is", () => {
    // The recalled text fills the composer; the next ↑ must still step back.
    expect(recallStep("ArrowUp", history, at(1, "middle"))).toEqual({
      index: 2,
      text: "oldest",
      draft: "",
    });
  });

  it("starts over from the newest once the composer is no longer the entry", () => {
    // Switching conversations empties the composer while the position stands —
    // resuming it would recall a message from the transcript you just left. An
    // edited entry is the same story: it is your draft now.
    expect(recallStep("ArrowUp", history, at(2, ""))).toEqual({
      index: 0,
      text: "newest",
      draft: "",
    });
    expect(recallStep("ArrowUp", history, at(0, "newest, edited"))).toEqual({
      index: 0,
      text: "newest",
      draft: "newest, edited",
    });
  });

  it("does nothing when there is no history yet", () => {
    expect(recallStep("ArrowUp", [], at(null, ""))).toBeNull();
  });
});
