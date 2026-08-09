/**
 * The TabRunner brand mark — a comet: a body in motion, with its trail behind.
 * Single source of truth for the extension icons and the OG card:
 * `bun run icons` (scripts/gen-icons.ts) rasterizes these into public/icon/.
 *
 * The wordmark carries "tab", so the glyph only has to carry "runner". Drawing
 * a literal tab was tried and abandoned: filled blocks side by side read as a
 * bar chart, and the window frame that makes a tab legible dissolves at 16px.
 *
 * Pure string builders, no React — safe to import from scripts and from any
 * runtime context.
 */

/** Comet glyph on a 48×48 canvas. Flat geometry: head + two speed trails. */
export function cometSvg(fill = "#ffffff"): string {
  return (
    `<circle fill="${fill}" cx="31" cy="24" r="7.5" />` +
    `<rect fill="${fill}" x="8" y="18" width="14" height="3.25" rx="1.625" />` +
    `<rect fill="${fill}" x="11" y="27.75" width="11" height="3.25" rx="1.625" />`
  );
}

/** Rounded brand tile with the comet — the extension icon. */
export function tileIconSvg(): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 48 48">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="48" y2="48" gradientUnits="userSpaceOnUse">
      <stop offset="0" stop-color="#8b5cf6" />
      <stop offset="1" stop-color="#6d28d9" />
    </linearGradient>
  </defs>
  <rect width="48" height="48" rx="11" fill="url(#g)" />
  ${cometSvg()}
</svg>`;
}
