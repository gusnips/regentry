import { describe, expect, it } from "vitest";
import { planGlyph, planGlyphClass } from "../ui/plan";

/**
 * The two functions classify the same index independently, so they can drift.
 * Pinning them to one state map is the whole check: a glyph that says "done"
 * wearing the gold of the step in flight is the bug this catches.
 */
const STATE = { "✓": "brand", "▪": "amber", "○": "neutral" } as const;

describe("plan glyphs", () => {
  it("agree on state across the done/current/pending boundaries", () => {
    for (const current of [0, 1, 3]) {
      for (let i = 0; i < 4; i++) {
        const glyph = planGlyph(i, current) as keyof typeof STATE;
        expect(planGlyphClass(i, current)).toContain(`text-${STATE[glyph]}-`);
      }
    }
  });
});
