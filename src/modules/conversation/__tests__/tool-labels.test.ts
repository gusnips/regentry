import { describe, it, expect } from "vitest";
import { toolHint } from "../ui/tool-labels";
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

describe("fitScale", () => {
  it("shrinks by the longest edge", () => {
    expect(fitScale(3000, 1500, 1500)).toBe(0.5);
    expect(fitScale(1500, 3000, 1500)).toBe(0.5);
  });

  it("never upscales a small image", () => {
    expect(fitScale(400, 300, 1500)).toBe(1);
  });
});
