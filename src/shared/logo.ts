/**
 * The TabRunner brand mark — the comet-tab: a browser-tab silhouette in
 * motion, ion trail behind it. Single source of truth for the extension icons
 * and the OG card: `bun run icons` (scripts/gen-icons.ts) rasterizes these
 * into public/icon/. Same geometry as the site's mark
 * (site/src/components/CometMark.tsx) — the two must not drift.
 *
 * Pure string builders, no React — safe to import from scripts and from any
 * runtime context.
 */

const TAB = "#e8eefb"; // starlight — the tab itself
const DOT = "#10b981"; // favicon dot
const TRAIL_NEAR = "#34d399"; // burn emerald — closest to the body
const TRAIL_FAR = "#6ee7b7"; // cooling — trailing off

/**
 * Comet-tab glyph on a 48×48 canvas: tab silhouette, favicon dot, two speed
 * trails. The "small" variant drops the trails and enlarges the tab — at 16px
 * the trails merge into mush and the dot shrinks below a pixel, so the icon
 * set renders the smallest size from this instead.
 */
export function cometSvg(variant: "full" | "small" = "full"): string {
  const tab =
    `<path d="M 23 30 L 23 20.5 Q 23 17 26.5 17 L 37.5 17 Q 41 17 41 20.5 L 41 30 Z" fill="${TAB}" />` +
    `<circle cx="27" cy="21.5" r="1.8" fill="${DOT}" />`;
  if (variant === "small") {
    return `<g transform="translate(24 23.5) scale(1.35) translate(-32 -23.5)">${tab}</g>`;
  }
  return (
    tab +
    `<rect x="7" y="19.5" width="12" height="3.25" rx="1.625" fill="${TRAIL_NEAR}" />` +
    `<rect x="10" y="26.25" width="9" height="3.25" rx="1.625" fill="${TRAIL_FAR}" />`
  );
}

/** Rounded deep-field tile with the comet-tab — the extension icon. */
export function tileIconSvg(variant: "full" | "small" = "full"): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 48 48">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="48" y2="48" gradientUnits="userSpaceOnUse">
      <stop offset="0" stop-color="#0b1224" />
      <stop offset="1" stop-color="#04060d" />
    </linearGradient>
  </defs>
  <rect width="48" height="48" rx="11" fill="url(#g)" />
  ${cometSvg(variant)}
</svg>`;
}
