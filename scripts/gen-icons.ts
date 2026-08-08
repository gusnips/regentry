#!/usr/bin/env bun
// Generate the extension icon set and the social OG card from the brand mark
// in src/shared/logo.ts (same pattern as olhary/featury gen-icons).
//
//   bun run icons          # or: bun run scripts/gen-icons.ts
//
// resvg rasterizes the SVGs; everything else is Bun-native. Chrome extensions
// want plain PNGs (no .ico), so the olhary png-to-ico step doesn't apply here.
import { Resvg } from "@resvg/resvg-js";
import { tileIconSvg } from "../src/shared/logo.ts";

const ROOT = `${import.meta.dir}/..`;

function renderPng(svg: string, width: number): Buffer {
  const r = new Resvg(svg, {
    fitTo: { mode: "width", value: width },
    font: { loadSystemFonts: true, defaultFontFamily: "Inter" },
  });
  return Buffer.from(r.render().asPng());
}

// ── social OG image (1200×630) — upload manually as the GitHub repo's social preview ──
function ogSvg(): string {
  const W = 1200;
  const H = 630;
  const tileAt = (x: number, y: number, size: number, id: string, opacity = 1): string =>
    tileIconSvg()
      .replace('width="48" height="48" ', "") // strip fixed size — the nested tile gets x/y/width/height below
      .replaceAll('id="g"', `id="${id}"`)
      .replaceAll("url(#g)", `url(#${id})`)
      .replace(
        'viewBox="0 0 48 48"',
        `x="${x}" y="${y}" width="${size}" height="${size}" viewBox="0 0 48 48" opacity="${opacity}"`,
      );

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <defs>
    <radialGradient id="glow" cx="85%" cy="8%" r="70%" gradientUnits="objectBoundingBox">
      <stop offset="0%" stop-color="#8b5cf6" stop-opacity="0.30" />
      <stop offset="70%" stop-color="#8b5cf6" stop-opacity="0" />
    </radialGradient>
    <linearGradient id="strip" x1="0" y1="0" x2="${W}" y2="0" gradientUnits="userSpaceOnUse">
      <stop offset="0%" stop-color="#6d28d9" />
      <stop offset="60%" stop-color="#8b5cf6" />
      <stop offset="100%" stop-color="#c4b5fd" />
    </linearGradient>
  </defs>
  <rect width="${W}" height="${H}" fill="#0e0a1a" />
  <rect width="${W}" height="${H}" fill="url(#glow)" />
  <g transform="rotate(-8 1060 350)">${tileAt(880, 150, 400, "ogw", 0.1)}</g>
  ${tileAt(72, 62, 52, "ogt")}
  <text x="140" y="98" font-family="Inter, sans-serif" font-size="24" font-weight="700" letter-spacing="7" fill="#ede9fe">REGENTRY</text>
  <text x="72" y="240" font-family="Inter, sans-serif" font-size="19" font-weight="700" letter-spacing="3" fill="#a78bfa">BROWSER AGENT · ANY PROVIDER</text>
  <text x="72" y="320" font-family="Inter, sans-serif" font-size="64" font-weight="700" letter-spacing="-2.5" fill="#f3f1fa">Your browser,</text>
  <text x="72" y="392" font-family="Inter, sans-serif" font-size="64" font-weight="700" letter-spacing="-2.5" fill="#f3f1fa">commanded.</text>
  <text x="72" y="456" font-family="Inter, sans-serif" font-size="22" fill="#a9a3c4">An LLM drives your real browser — your sessions, your logins —</text>
  <text x="72" y="488" font-family="Inter, sans-serif" font-size="22" fill="#a9a3c4">through OpenAI, Anthropic, or any compatible endpoint.</text>
  <text x="1128" y="596" font-family="Inter, sans-serif" font-size="20" fill="#6d6a86" text-anchor="end" letter-spacing="1">github.com/gusnips/regentry</text>
  <rect y="${H - 8}" width="${W}" height="8" fill="url(#strip)" />
</svg>`;
}

// ── emit ──────────────────────────────────────────────────────────────────────
console.log("regentry · generating brand assets → public/icon, docs/\n");

let bytes = 0;
let count = 0;
const write = async (file: string, data: string | Buffer) => {
  bytes += await Bun.write(`${ROOT}/${file}`, data);
  count += 1;
  console.log(`   ✓ ${file}`);
};

const TILE = tileIconSvg();
await write("public/icon.svg", TILE + "\n");
for (const size of [16, 32, 48, 96, 128]) {
  await write(`public/icon/${size}.png`, renderPng(TILE, size));
}
await write("docs/og.png", renderPng(ogSvg(), 1200));

console.log(`\ndone — ${count} files, ${(bytes / 1024).toFixed(1)} KB.`);
