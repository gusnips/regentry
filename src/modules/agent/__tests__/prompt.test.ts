import { describe, it, expect } from "vitest";
import { buildSystemPrompt, buildToolDefs } from "../prompt";
import { DURABLE_FACT_RULES, type AgentContext } from "@/modules/memory";

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

  // Both in-run writing surfaces quote the one definition; the extraction prompt
  // is the third, checked in memory/__tests__/extract.test.ts. Restating the
  // criteria per surface is what let them drift into saving stale page readings.
  it("states MEMORY.md's admission rules once, on every surface that writes it", () => {
    expect(buildSystemPrompt({ ...ctx, memoryOn: true }, "English")).toContain(DURABLE_FACT_RULES);

    const remember = buildToolDefs(true).find((t) => t.name === "remember");
    expect(remember?.description).toContain(DURABLE_FACT_RULES);
  });

  it("withholds MEMORY.md and its rules when memory is off", () => {
    const prompt = buildSystemPrompt(ctx, "English");
    expect(prompt).not.toContain("MEMORY.md");
    expect(buildToolDefs(false).map((t) => t.name)).not.toContain("remember");
  });

  it("carries the operational rules the base prompt would otherwise never teach", () => {
    // Each guards a different real failure: an unverified submit, a frozen tab,
    // a retry loop, a stale ref, a hallucinated URL, and a CAPTCHA wall.
    // Losing one is a silent capability loss.
    const prompt = buildSystemPrompt(ctx, "English");
    expect(prompt).toMatch(/verify with a snapshot before you call done/i);
    expect(prompt).toMatch(/alert, confirm, prompt/i);
    expect(prompt).toMatch(/2–3 failures/i);
    expect(prompt).toMatch(/stale/i);
    expect(prompt).toMatch(/never guess a deep URL/i);
    expect(prompt).toMatch(/CAPTCHA/i);
  });

  it("frames page content as untrusted data, not instructions", () => {
    const prompt = buildSystemPrompt(ctx, "English");
    expect(prompt).toMatch(/untrusted data/i);
    expect(prompt).toMatch(/never an instruction/i);
  });
});
