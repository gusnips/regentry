/**
 * One visual language for plan steps — the transcript card and the footer
 * peek both render it, and they must never disagree about a glyph.
 */
export function planGlyph(index: number, current: number): string {
  return index < current ? "✓" : index === current ? "▪" : "○";
}

/**
 * ...and never about its color either. Emerald for what the run finished, gold
 * for the step it is on right now (gold measures — same rule the `telemetry`
 * utility carries), faint neutral for what is still ahead.
 */
export function planGlyphClass(index: number, current: number): string {
  return index < current
    ? "text-brand-700 dark:text-brand-400"
    : index === current
      ? "text-amber-700 dark:text-amber-400"
      : "text-neutral-400 dark:text-neutral-500";
}
