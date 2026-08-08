/**
 * The Regentry brand mark — a crown, for the one who rules in your stead.
 * Single source of truth for the extension icons and the OG card:
 * `bun run icons` (scripts/gen-icons.ts) rasterizes these into public/icon/.
 *
 * Pure string builders, no React — safe to import from scripts and from any
 * runtime context.
 */

/** Crown glyph on a 48×48 canvas. Flat geometric crown: peaks + band. */
export function crownSvg(fill = "#ffffff"): string {
  return (
    `<path fill="${fill}" d="M13 31.5V19.5L19.75 25 24 15.5 28.25 25 35 19.5V31.5Z" />` +
    `<rect fill="${fill}" x="13" y="33.75" width="22" height="3.25" rx="1.625" />`
  );
}

/** Rounded brand tile with the crown — the extension icon. */
export function tileIconSvg(): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 48 48">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="48" y2="48" gradientUnits="userSpaceOnUse">
      <stop offset="0" stop-color="#8b5cf6" />
      <stop offset="1" stop-color="#6d28d9" />
    </linearGradient>
  </defs>
  <rect width="48" height="48" rx="11" fill="url(#g)" />
  ${crownSvg()}
</svg>`;
}
