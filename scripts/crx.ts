/**
 * Pack the built extension into a signed CRX (CRX3) — the interim install
 * artifact tabrunner.app offers until the store listing is approved. The Chrome
 * Web Store serves its own signed CRX — only Google has that key, so a store CRX
 * can never be produced locally. This signs with the gitignored
 * `tabrunner-test.pem`, and the resulting extension ID (printed below) differs
 * from the store item's — expected and harmless. CI signs with the same key via
 * the CRX_SIGNING_KEY repo secret, so a local and a CI build share one ID.
 *
 *   bun run crx          # build + pack → dist/tabrunner-<version>.crx
 *
 * Requires a Chromium binary (Chrome/Brave/Edge/Chromium) and the signing key.
 * Generate the key once, then keep it (it's gitignored — committing it would
 * let anyone ship updates to existing installs):
 *
 *   openssl genrsa -out tabrunner-test.pem 2048
 */
import { $ } from "bun";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

process.chdir(fileURLToPath(new URL("..", import.meta.url)));

const KEY = "tabrunner-test.pem";
const VERSION = ((await Bun.file("package.json").json()) as { version: string }).version;
const OUT = `dist/tabrunner-${VERSION}.crx`;

if (!existsSync(KEY)) {
  console.error(`✗ Missing signing key ${KEY} — the CRX's extension ID depends on it.`);
  console.error("  Generate it once (keep it; it's gitignored):");
  console.error("    openssl genrsa -out tabrunner-test.pem 2048");
  process.exit(1);
}

// --pack-extension lives on a Chromium binary; pack with the first one found.
const browser =
  process.env.CRX_BROWSER ??
  [
    "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser",
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
  ].find((p) => existsSync(p)) ??
  ["google-chrome", "brave-browser", "chromium", "microsoft-edge"]
    .map((name) => Bun.which(name))
    .find((p) => p != null);

if (!browser) {
  console.error("✗ No Chromium binary found to run --pack-extension.");
  console.error("  Install Chrome, Brave, Edge, or Chromium, or set CRX_BROWSER=/path/to/binary.");
  process.exit(1);
}

console.log("▪ build");
await $`bun run build`;
console.log("▪ pack");
await $`${browser} --pack-extension=dist/chrome-mv3 --pack-extension-key=${KEY}`;
await $`mv dist/chrome-mv3.crx ${OUT}`;

const bytes = new Uint8Array(await Bun.file(OUT).arrayBuffer());
if (new TextDecoder().decode(bytes.slice(0, 4)) !== "Cr24") {
  console.error(`✗ ${OUT} does not start with the CRX3 magic "Cr24" — packing failed.`);
  process.exit(1);
}

// The extension ID is derived from the public half of the signing key (SPKI DER
// → SHA-256 → first 16 bytes → 32 nibbles → a–p). Same derivation Chrome uses.
const spki = (await $`openssl rsa -in ${KEY} -pubout -outform DER`.quiet()).stdout;
const digest = new Bun.CryptoHasher("sha256").update(spki).digest();
const id = [...digest.subarray(0, 16)]
  .flatMap((b) => [b >> 4, b & 0xf])
  .map((n) => "abcdefghijklmnop"[n]!)
  .join("");

console.log(`\n✔ ${OUT}  (${(bytes.byteLength / 1024).toFixed(0)} kB)`);
console.log(`  id        ${id}`);
console.log("  install   chrome://extensions → Developer mode → drag the .crx onto the page");
