import { describe, it, expect } from "vitest";
import { toolHint } from "../ui/tool-labels";
import { stepHint } from "../step-hint";
import { fitScale } from "../ui/image";

describe("toolHint", () => {
  it("reduces a URL to its host, without www", () => {
    expect(toolHint("navigate", { url: "https://www.example.com/a/b?c=d" })).toBe("example.com");
  });

  it("falls back to the raw value when the URL will not parse", () => {
    expect(toolHint("navigate", { url: "example.com/path" })).toBe("example.com/path");
  });

  it("truncates long typed text so a row stays one line", () => {
    const hint = toolHint("type", { text: "x".repeat(200) });
    expect(hint).toHaveLength(48);
    expect(hint?.endsWith("…")).toBe(true);
  });

  it("shows where a fill landed and what it wrote", () => {
    expect(toolHint("fill", { ref: "e12", text: "93619-155" })).toBe("e12: 93619-155");
    // Clearing a field carries no text — the ref alone is the trace.
    expect(toolHint("fill", { ref: "e12", text: "" })).toBe("e12");
  });

  it("shows the code an evaluate ran — the code is the action", () => {
    expect(toolHint("evaluate", { expression: "document.title" })).toBe("document.title");
  });

  it("has no hint for tools that take no distinguishing argument", () => {
    expect(toolHint("snapshot", {})).toBeUndefined();
    expect(toolHint("screenshot", {})).toBeUndefined();
  });

  it("ignores arguments of the wrong type instead of printing them", () => {
    expect(toolHint("click", { ref: 12 })).toBeUndefined();
    expect(toolHint("scroll_down", { amount: "lots" })).toBeUndefined();
    expect(toolHint("scroll_down", { amount: 600 })).toBe("600px");
  });

  it("has no hint without a tool or arguments", () => {
    expect(toolHint(undefined, { url: "https://example.com" })).toBeUndefined();
    expect(toolHint("navigate", undefined)).toBeUndefined();
  });
});

/**
 * toolHint (panel rows) and stepHint (transcript notes / read_history) are the
 * same switch on opposite sides of the runtime boundary — they drifted apart
 * twice already. This is the mechanical guard the file comment only asks for.
 */
describe("toolHint / stepHint parity", () => {
  const CASES: [string, Record<string, unknown>][] = [
    ["navigate", { url: "https://www.example.com/a" }],
    ["switch_tab", { tab_id: 42 }],
    ["group_tab", { tab_id: 42 }],
    ["click", { ref: "e3" }],
    ["fill", { ref: "e3", text: "hello" }],
    ["type", { text: "hello" }],
    ["press_key", { key: "Enter" }],
    ["scroll_down", { amount: 800 }],
    ["scroll_up", { amount: 800 }],
    ["evaluate", { expression: "document.title" }],
    ["read_network_requests", { url_filter: "api" }],
    ["snapshot", {}],
    ["screenshot", {}],
    ["read_history", { from: 0 }],
    ["read_console_messages", { only_errors: true }],
    ["ask_user", { question: "Ship it?" }],
  ];

  it("both twins hint — or stay silent — for the same tools", () => {
    for (const [tool, args] of CASES) {
      expect(Boolean(stepHint(tool, args)), `stepHint(${tool})`).toBe(
        Boolean(toolHint(tool, args)),
      );
    }
  });
});

describe("fitScale", () => {
  it("shrinks by the longest edge", () => {
    expect(fitScale(3000, 1500, 1500)).toBe(0.5);
    expect(fitScale(1500, 3000, 1500)).toBe(0.5);
  });

  it("never upscales a small image", () => {
    expect(fitScale(400, 300, 1500)).toBe(1);
  });
});
