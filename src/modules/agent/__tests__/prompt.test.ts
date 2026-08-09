import { describe, it, expect } from "vitest";
import { buildSystemPrompt, buildToolDefs } from "../prompt";
import type { AgentContext } from "@/modules/memory";

// i18n comes from src/test-setup.ts (vitest setupFiles).

const ctx: AgentContext = { instructions: "", memory: "", memoryOn: false };

describe("buildToolDefs", () => {
  it("hides the screenshot tool from a text-only model", () => {
    const names = buildToolDefs(false, false).map((t) => t.name);
    expect(names).toContain("snapshot");
    expect(names).not.toContain("screenshot");
  });

  it("offers the screenshot tool by default", () => {
    expect(buildToolDefs(false).map((t) => t.name)).toContain("screenshot");
  });
});

describe("buildSystemPrompt", () => {
  it("adds a text-only note when the model can't receive images", () => {
    const prompt = buildSystemPrompt(ctx, "English", false);
    expect(prompt).toContain("text-only");
    expect(prompt).toContain("no screenshot tool");
  });

  it("omits the note for image-capable models", () => {
    expect(buildSystemPrompt(ctx, "English")).not.toContain("text-only");
  });

  it("carries the four operational rules the base prompt would otherwise never teach", () => {
    // Each guards a different real failure: an unverified submit, a frozen tab,
    // a retry loop, and a stale ref. Losing one is a silent capability loss.
    const prompt = buildSystemPrompt(ctx, "English");
    expect(prompt).toMatch(/verify with a snapshot before you call done/i);
    expect(prompt).toMatch(/alert, confirm, prompt/i);
    expect(prompt).toMatch(/2–3 times/i);
    expect(prompt).toMatch(/stale/i);
  });
});
