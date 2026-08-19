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

  it("decodes the \\uXXXX escapes models write for non-ASCII", () => {
    expect(parseToolArgs('{"summary": "aten\\u00e7\\u00e3o"}').summary).toBe("atenção");
  });

  it("heals a model that escaped its accents twice", () => {
    // The wire carried `\\u00e7`, so a correct parse still leaves the literal
    // escape in the string — the answer would reach the user as `aten\u00e7\u00e3o`.
    expect(parseToolArgs('{"summary": "aten\\\\u00e7\\\\u00e3o"}').summary).toBe("atenção");
  });

  it("heals double escapes nested in arrays and objects", () => {
    expect(parseToolArgs('{"steps": ["a\\\\u00e7", {"b": "\\\\u00e3o"}]}')).toEqual({
      steps: ["aç", { b: "ão" }],
    });
  });

  it("drops the escape fragment a cut landed inside", () => {
    expect(parseToolArgs('{"summary": "aten\\u00').summary).toBe("aten");
    expect(parseToolArgs('{"summary": "fim\\').summary).toBe("fim");
  });

  it("does not decode past an escaped backslash", () => {
    // `\\` then `n` is a literal path, not a newline — the chained replaces used
    // to unescape the backslash first and then read `\n` out of what was left.
    expect(parseToolArgs('{"summary": "C:\\\\novo').summary).toBe("C:\\novo");
  });

  it("salvages the escapes the old chain missed", () => {
    expect(parseToolArgs('{"summary": "a\\fb\\bc').summary).toBe("a\fb\bc");
  });

  it("returns {} when the args payload is not an object", () => {
    expect(parseToolArgs("[1,2]")).toEqual({});
  });
});
