import { describe, it, expect, vi, beforeAll } from "vitest";
import { executeTool } from "../tools";
import type { BrowserDriver } from "@/modules/browser";
import { i18n } from "@/i18n";
import en from "@/i18n/locales/en.json";

// @/i18n's locale item reads wxt storage at module scope — no chrome in tests.
vi.mock("wxt/utils/storage", () => ({
  storage: {
    defineItem: (_key: string, opts?: { fallback?: unknown }) => {
      let value: unknown = opts?.fallback ?? null;
      return {
        getValue: async () => value,
        setValue: async (v: unknown) => void (value = v),
        removeValue: async () => void (value = null),
        watch: () => () => {},
      };
    },
  },
}));

beforeAll(async () => {
  await i18n.init({
    resources: { en: { translation: en } },
    lng: "en",
    interpolation: { escapeValue: false },
    returnEmptyString: false,
  });
});

// `plan` is pure bookkeeping — it never reaches the driver, so an empty stub is
// enough and a real one would only hide that fact.
const noDriver = {} as unknown as BrowserDriver;

function plan(args: Record<string, unknown>) {
  return executeTool({ id: "t1", name: "plan", args }, noDriver);
}

describe("plan tool", () => {
  it("keeps the steps and the cursor as given", async () => {
    const result = await plan({ steps: ["Open the page", "Read it"], current: 1 });
    expect(result).toEqual({ ok: true, data: { steps: ["Open the page", "Read it"], current: 1 } });
  });

  it("clamps a cursor past the end instead of rejecting the plan", async () => {
    // Models routinely send a 1-based index; the plan is display-only, so a
    // wrong number must never fail the run.
    const result = await plan({ steps: ["a", "b"], current: 7 });
    expect(result.data).toEqual({ steps: ["a", "b"], current: 2 });
  });

  it("clamps a negative or unparseable cursor to the first step", async () => {
    expect((await plan({ steps: ["a"], current: -3 })).data).toEqual({ steps: ["a"], current: 0 });
    expect((await plan({ steps: ["a"], current: "soon" })).data).toEqual({
      steps: ["a"],
      current: 0,
    });
  });

  it("drops blank and non-string entries", async () => {
    const result = await plan({ steps: ["real", "   ", 42, null, "also real"], current: 0 });
    expect(result.data).toEqual({ steps: ["real", "also real"], current: 0 });
  });

  it("fails with an actionable message when no step survives", async () => {
    const result = await plan({ steps: ["", "  "], current: 0 });
    expect(result.ok).toBe(false);
    expect(result.error).toContain("at least one step");
  });

  it("caps a runaway plan rather than flooding the card", async () => {
    const steps = Array.from({ length: 40 }, (_, i) => `step ${i}`);
    const result = await plan({ steps, current: 39 });
    expect((result.data as { steps: string[] }).steps).toHaveLength(20);
    // The cursor clamps to the truncated length, never past it.
    expect((result.data as { current: number }).current).toBe(20);
  });
});
