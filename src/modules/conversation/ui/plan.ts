/**
 * One visual language for plan steps — the transcript card and the footer
 * peek both render it, and they must never disagree about a glyph.
 */
export function planGlyph(index: number, current: number): string {
  return index < current ? "✓" : index === current ? "▪" : "○";
}
