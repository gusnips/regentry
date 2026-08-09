/**
 * Visual inspection harness: loads the built extension (dist/chrome-mv3 — run
 * `bun run build` first) into Chrome for Testing and screenshots the options
 * page and side panel in light and dark. Output is gitignored (preview/).
 * For the store set use `bun run shots` instead.
 *
 *   bun run shots:ui
 */
import { existsSync, mkdirSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import puppeteer from "puppeteer-core";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const extPath = join(root, "dist", "chrome-mv3");
const outDir = join(root, "preview", "shots");
mkdirSync(outDir, { recursive: true });

/**
 * Branded Chrome ignores --load-extension in headless; Chrome for Testing
 * doesn't. Resolve the newest CfT from the puppeteer cache, fall back to the
 * system Chrome.
 */
function findChrome(): string {
  const cache = join(homedir(), ".cache", "puppeteer", "chrome");
  if (existsSync(cache)) {
    for (const version of readdirSync(cache).sort().reverse()) {
      const dir = join(cache, version);
      for (const arch of existsSync(dir) ? readdirSync(dir) : []) {
        const bin = join(
          dir,
          arch,
          "Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing",
        );
        if (existsSync(bin)) return bin;
      }
    }
  }
  return "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
}

const browser = await puppeteer.launch({
  executablePath: findChrome(),
  headless: true,
  args: [`--disable-extensions-except=${extPath}`, `--load-extension=${extPath}`],
});

// The extension id falls out of its service worker target.
let extId = "";
for (let i = 0; i < 50 && !extId; i++) {
  const sw = browser.targets().find((t) => t.type() === "service_worker");
  const match = sw?.url().match(/^chrome-extension:\/\/([^/]+)\//);
  if (match) extId = match[1];
  else await new Promise((r) => setTimeout(r, 100));
}
if (!extId) {
  console.error("extension service worker never appeared — is the build current?");
  process.exit(1);
}
console.log(`extension id: ${extId}`);

/**
 * Chrome's side panel opens around 400px and the options page is a wide
 * document — shooting both at 1280 made every panel review a lie, all the
 * whitespace in the world and no line ever wrapping where it really wraps.
 */
const SIDEPANEL_WIDTH = 400;

async function shoot(page_: string, name: string, dark: boolean, width = 1280) {
  const page = await browser.newPage();
  await page.setViewport({ width, height: 800 });
  await page.emulateMediaFeatures([
    { name: "prefers-color-scheme", value: dark ? "dark" : "light" },
  ]);
  await page.goto(`chrome-extension://${extId}/${page_}`, { waitUntil: "networkidle0" });
  await page.evaluate(() => void document.fonts.ready);
  await new Promise((r) => setTimeout(r, 600));
  await page.screenshot({ path: join(outDir, `${name}.png`) });
  console.log(`${name}: shot`);
  await page.close();
}

/**
 * A stand-in transcript, so the review sees the surface people actually live
 * in — plan card, step rows, bubbles, an error — instead of the empty state
 * the panel shows for about ten seconds of its life. Written straight to the
 * storage keys `defineItem` builds ("local:tabrunner:<key>").
 */
async function seedConversation() {
  const page = await browser.newPage();
  await page.goto(`chrome-extension://${extId}/sidepanel.html`);
  await page.evaluate(() => {
    const id = "shots-demo";
    const t = 1_700_000_000_000;
    let n = 0;
    const msg = (m: Record<string, unknown>) => ({ id: `m${++n}`, timestamp: t + n * 1000, ...m });
    return chrome.storage.local.set({
      // Without a provider the panel shows onboarding, transcript or not.
      "tabrunner:active-provider": "shots-provider",
      "tabrunner:providers": [
        {
          id: "shots-provider",
          name: "Anthropic",
          shape: "anthropic",
          baseUrl: "https://api.anthropic.com",
          apiKey: "sk-ant-preview",
          model: "claude-sonnet-4-5",
          reasoningEffort: "medium",
          createdAt: t,
        },
      ],
      "tabrunner:active-conversation": id,
      "tabrunner:conversations": [
        {
          id,
          title: "Pull the latest invoice from my inbox into the expense report",
          createdAt: t,
          updatedAt: t + 60_000,
          messageCount: 8,
        },
      ],
      [`tabrunner:conversation:${id}`]: [
        msg({
          role: "user",
          content: "Pull the latest invoice from my inbox into the expense report",
          tab: { title: "Inbox — webmail", url: "https://mail.example.com/inbox" },
        }),
        msg({
          role: "plan",
          content: "",
          steps: [
            "Open the inbox",
            "Find the latest invoice",
            "Open the expense report",
            "Attach it and fill the fields",
          ],
          current: 1,
        }),
        msg({ role: "reasoning", content: "Checking which tab is in front…", elapsed: 4200 }),
        msg({
          role: "step",
          tool: "navigate",
          ok: true,
          content: "",
          args: { url: "https://mail.example.com/inbox" },
        }),
        msg({
          role: "step",
          tool: "snapshot",
          ok: true,
          content: "",
          detail: "Captured 214 elements",
        }),
        msg({ role: "step", tool: "click", ok: true, content: "", args: { ref: "e42" } }),
        msg({
          role: "error",
          content: "The tab this task was driving (Inbox — webmail) was closed — the run stopped.",
          kind: "network",
        }),
        msg({
          role: "assistant",
          content:
            "I found the **March invoice** (`INV-2291`, $412.60) and attached it to the expense report. The vendor and date fields are filled; the category is still blank because the form offers no match for “cloud hosting”.",
        }),
      ],
    });
  });
  await page.close();
}

for (const dark of [false, true]) {
  const mode = dark ? "dark" : "light";
  await shoot("options.html", `ext-options-${mode}`, dark);
  await shoot("sidepanel.html", `ext-sidepanel-${mode}`, dark, SIDEPANEL_WIDTH);
}
await seedConversation();
for (const dark of [false, true]) {
  const mode = dark ? "dark" : "light";
  await shoot("sidepanel.html", `ext-chat-${mode}`, dark, SIDEPANEL_WIDTH);
}
await browser.close();
