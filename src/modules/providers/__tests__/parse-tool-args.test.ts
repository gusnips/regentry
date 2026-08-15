import { describe, it, expect } from "vitest";

import { parseToolArgs } from "../http";

describe("parseToolArgs", () => {
  it("parses intact args", () => {
    expect(parseToolArgs('{"url":"https://x.com","n":3}')).toEqual({ url: "https://x.com", n: 3 });
  });

  it("returns {} for empty input", () => {
    expect(parseToolArgs("")).toEqual({});
  });

  it("salvages a done summary cut mid-string — the whole answer survives", () => {
    // The exact failure: output cap cut the stream inside the summary value.
    const raw = '{"summary": "1. Como funciona: os lances sao visiveis. 2. Precisa aplicar? Sim';
    const args = parseToolArgs(raw);
    expect(args.summary).toBe("1. Como funciona: os lances sao visiveis. 2. Precisa aplicar? Sim");
  });

  it("unescapes quotes and newlines inside a salvaged summary", () => {
    const raw = '{"summary": "ele disse \\"sim\\"\\ne depois parou';
    expect(parseToolArgs(raw).summary).toBe('ele disse "sim"\ne depois parou');
  });

  it("keeps complete string fields when a later one is cut", () => {
    const raw = '{"a": "done", "summary": "the answer was cut off here';
    expect(parseToolArgs(raw)).toEqual({ a: "done", summary: "the answer was cut off here" });
  });

  it("drops non-string fields that were cut, keeps the strings", () => {
    const raw = '{"summary": "kept", "current": 12';
    expect(parseToolArgs(raw)).toEqual({ summary: "kept" });
  });

  it("returns {} for truncated JSON with no string field at all", () => {
    expect(parseToolArgs('{"steps": ["a", "b')).toEqual({});
  });
});
