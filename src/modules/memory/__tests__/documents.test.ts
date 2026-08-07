import { describe, it, expect } from "vitest";

// Storage stand-in (reset between tests) and i18n come from src/test-setup.ts.

import { remember, getDoc, setDoc, memoryEnabled, loadAgentContext } from "../documents";
import { buildSystemPrompt, buildToolDefs } from "@/modules/agent/prompt";

describe("remember", () => {
  it("appends one bullet per fact", async () => {
    await remember("The user's work account is me@acme.com.");
    await remember("Invoices live at billing.acme.com.");
    expect(await getDoc("MEMORY.md")).toBe(
      "- The user's work account is me@acme.com.\n- Invoices live at billing.acme.com.\n",
    );
  });

  it("normalizes what the model sends — bullets, padding, stray newlines", async () => {
    await remember("  - The\n  user prefers metric units.  ");
    expect(await getDoc("MEMORY.md")).toBe("- The user prefers metric units.\n");
  });

  it("ignores a fact it already knows, whatever the casing", async () => {
    await remember("Login is the email link, not SSO.");
    await remember("login is the EMAIL link, not sso.");
    expect(await getDoc("MEMORY.md")).toBe("- Login is the email link, not SSO.\n");
  });

  it("rejects an empty fact instead of writing a bare bullet", async () => {
    expect(await remember("   ")).toBeNull();
    expect(await getDoc("MEMORY.md")).toBe("");
  });

  it("evicts oldest entries past the cap but always keeps the newest", async () => {
    await setDoc("MEMORY.md", `- ${"x".repeat(7_990)}\n- an older fact\n`);
    await remember("the newest fact");
    const doc = await getDoc("MEMORY.md");
    expect(doc).toContain("- the newest fact");
    expect(doc).not.toContain("xxx");
    expect(doc.length).toBeLessThanOrEqual(8_000);
  });
});

describe("loadAgentContext", () => {
  it("loads both docs and offers the remember tool when memory is on", async () => {
    await setDoc("AGENTS.md", "Always confirm before paying.");
    await remember("The user's handle is gus.");

    const ctx = await loadAgentContext();
    expect(ctx.memoryOn).toBe(true);

    const prompt = buildSystemPrompt(ctx, "English");
    expect(prompt).toContain("Always confirm before paying.");
    expect(prompt).toContain("- The user's handle is gus.");
    expect(buildToolDefs(ctx.memoryOn).map((t) => t.name)).toContain("remember");
  });

  it("keeps instructions but drops memory and the tool when memory is off", async () => {
    await setDoc("AGENTS.md", "Always confirm before paying.");
    await remember("The user's handle is gus.");
    await memoryEnabled.set(false);

    const ctx = await loadAgentContext();
    const prompt = buildSystemPrompt(ctx, "English");
    expect(prompt).toContain("Always confirm before paying.");
    expect(prompt).not.toContain("MEMORY.md");
    expect(prompt).not.toContain("gus");
    expect(buildToolDefs(ctx.memoryOn).map((t) => t.name)).not.toContain("remember");
  });

  it("still announces MEMORY.md while it is empty — an unmentioned file is never written to", async () => {
    const prompt = buildSystemPrompt(await loadAgentContext(), "English");
    expect(prompt).toContain("# MEMORY.md");
    expect(prompt).toContain("(empty");
    expect(prompt).not.toContain("# AGENTS.md");
  });

  it("names the user's language for the plan steps and the done summary", async () => {
    const prompt = buildSystemPrompt(await loadAgentContext(), "Português (Brasil)");
    expect(prompt).toContain("Português (Brasil)");
  });
});
