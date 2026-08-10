# TabRunner — Chrome Web Store listing

Source of truth for the store submission. Copy-paste from the blocks below into the CWS dashboard
(`chrome.google.com/webstore/devconsole` → TabRunner → **Store listing**). Everything here is kept in
sync with the product; when a feature lands, update the matching block and re-submit.

> Status: **withdraw v0.1.0 from review and resubmit.** Subscription sign-in (Anthropic, OpenAI,
> Kimi) needs one new permission — `declarativeNetRequestWithHostAccess` — and a submission in
> review can't change its permission set. Pull it, ship a new version, resubmit with the §5
> justifications below. Everything else in this doc is current.

**Copy buttons.** Each block the dashboard takes has a copy button under it. In a Markdown
preview they render as working buttons; in plain text they're `<button>` tags you can ignore —
either way the fenced block directly above each one is the string to paste, verbatim.

<script>
  // Copy the fenced code block immediately above a [data-copy] button. Tagged
  // blocks (not the global navigator) so a preview that strips scripts degrades
  // to a plain button, never a broken page.
  function copyBlock(btn) {
    const block = btn.closest("[data-copy-block]")?.querySelector("pre");
    if (block) navigator.clipboard?.writeText(block.innerText.trimEnd());
  }
</script>
<style>
  .copy-btn {
    font: inherit;
    font-size: 0.75rem;
    padding: 0.15rem 0.6rem;
    border: 1px solid currentColor;
    border-radius: 0.4rem;
    background: none;
    cursor: pointer;
    opacity: 0.7;
  }
  .copy-btn:hover {
    opacity: 1;
  }
</style>

---

## 1. Identity

| Field            | Value                                                                         |
| ---------------- | ----------------------------------------------------------------------------- |
| **Name**         | TabRunner                                                                     |
| **Category**     | Productivity                                                                  |
| **Language**     | English (listing is localized: en / pt-BR / es shipped in `public/_locales/`) |
| **Visibility**   | Public                                                                        |
| **Support URL**  | https://github.com/gusnips/tabrunner/issues                                   |
| **Homepage URL** | https://tabrunner.app                                                         |
| **Extension ID** | `ilnohobdcigbmlikjbkdpbkhciephdle` (assigned 2026-08-10)                      |
| **Store URL**    | https://chromewebstore.google.com/detail/ilnohobdcigbmlikjbkdpbkhciephdle     |

**Title field** (≤ 45 chars) — use the plain name, it's the strongest brand:

<div data-copy-block>

```
TabRunner
```

<button class="copy-btn" data-copy onclick="copyBlock(this)">⧉ Copy</button>

</div>

---

## 2. Short description (≤ 132 characters)

Use this string (109 chars — comfortable headroom under the 132 limit):

<div data-copy-block>

```
An AI agent that drives your real browser — your tabs, sessions and logins — through any provider you choose.
```

<button class="copy-btn" data-copy onclick="copyBlock(this)">⧉ Copy</button>

</div>

> Verify in the dashboard (it shows a counter). All three localized variants are also under the cap.

**Localized short descriptions** (same 132-char cap each):

- **Português (Brasil):**

  <div data-copy-block>

  ```
  Um agente de IA que dirige seu navegador de verdade — abas, sessões e logins — com qualquer provedor que você escolher.
  ```

  <button class="copy-btn" data-copy onclick="copyBlock(this)">⧉ Copy</button>

  </div>

- **Español:**

  <div data-copy-block>

  ```
  Un agente de IA que maneja tu navegador real — pestañas, sesiones y accesos — con el proveedor que elijas.
  ```

  <button class="copy-btn" data-copy onclick="copyBlock(this)">⧉ Copy</button>

  </div>

---

## 3. Full description

Markdown-friendly subset: `##`/`###`, `**bold**`, `-` lists, links. CWS renders headings as
sections. Paste as-is.

<div data-copy-block>

```markdown
## You give the goal. It runs the tabs.

TabRunner is a browser agent that lives in your browser and works in it — not in a sandbox. It
opens your tabs, uses your logged-in sessions, and reads, clicks and types on the sites you
already use, until the task you described is done.

- **Works in your real browser** — your existing logins are its sessions. No setup on every site,
  no fake profile, no separate account.
- **Bring your own provider** — sign in with a subscription you already pay for (Anthropic,
  OpenAI, Kimi) or paste an API key, across 15 presets (Anthropic, OpenAI, Kimi, Z.ai, Qwen,
  DeepSeek, Gemini, OpenRouter, Groq, Mistral, xAI, Ollama) plus any endpoint speaking the OpenAI
  or Anthropic wire format. No vendor lock-in, no relay, no TabRunner server.
- **Your credentials stay yours** — a key or a sign-in goes straight from the extension to your
  provider. Nothing is stored outside Chrome. No account, no telemetry.
- **Trusted input** — clicks and keystrokes go through the Chrome DevTools Protocol, so they are
  genuine trusted events, not synthetic dispatches sites can ignore.
- **See the work** — a live plan, current action, token spend and elapsed time while the agent
  runs, Claude Code-style. Every step is logged in the conversation.

## How it works

1. Describe a task in the side panel — e.g. "open my inbox and summarize the last 3 emails".
2. TabRunner reads the page's accessibility tree and lets the model drive the tab: navigate,
   click, type, scroll, screenshot — as real user input.
3. Watch it work, step by step. Hit **Stop** at any time — queued messages run as the next task.

## Private by design

- No TabRunner server exists. The extension speaks to your provider directly.
- Provider configs and conversation history live in `chrome.storage` on this device.
- The model never receives raw HTML — it works from a compact semantic tree of the page, and
  sensitive fields (passwords, card numbers) never leave the page.
- Works on Chrome, Brave, Edge, Arc, Opera and Vivaldi.

## Guardrails

- **Ask before acting** — consequential actions (paying, sending, deleting) ask for your
  confirmation in the panel before they happen.
- **Stop is real** — Esc, the Stop button, or the Run Board stops the agent. Tasks keep working
  in their own background tab after the panel closes — stop them there, not by closing.
- **Reasoning effort** — pin `none` → `max` per task, or leave Auto and TabRunner runs the newest
  model your endpoint lists.

## Languages

English · Português (Brasil) · Español. Light and dark theme, or follow your OS.
```

<button class="copy-btn" data-copy onclick="copyBlock(this)">⧉ Copy</button>

</div>

---

## 4. Screenshots

CWS requirements: **1280×800** or **640×400**, PNG or JPEG, 1–5 images, the first is the card image.
The panel and options pages are TabRunner's own `chrome-extension://` pages, so they are never
"debugged" and capture without any browser warning bar — no workaround needed.

Captured set (in this order — the first is the card image):

1. **`01-side-panel.png`** — Wikipedia's "Web browser" article with the side panel beside it,
   pre-task: the task typed in the composer, not yet sent. The panel is the product, not a
   browser takeover.
2. **`02-chat.png`** — Wikipedia's "Intelligent agent" with a finished run in the panel: user
   bubble, plan card, tool trace, the agent's summary; the "controlling this tab" badge rides
   the page's top-right.
3. **`03-providers.png`** — the options page's Providers tab: subscription rows (Anthropic,
   OpenAI) and an API-key row (DeepSeek), active provider highlighted.
4. **`04-chat-2.png`** — Hacker News with a second conversation and the floating status widget
   bottom-right (task · +1 queued · Open · Hide).

All four are **1280×800 PNG** (16:10), the CWS-required dimensions — no 16:9 crops.

Capture recipe: `bun run build && bun run shots` (scripts/shoot-store.ts). No extension API can
raster the side panel, so the script seeds demo providers + conversations into Chrome for Testing,
shoots the panel as its own page, and composites panel-over-page at exactly 1280×800 — badge and
status widget included. It also refreshes the site's webp derivatives when `../site` is checked out.
Rerun after any UI rebrand; eyeball the four before committing.

Saved in `docs/screenshots/` as `01-side-panel.png`, `02-chat.png`, `03-providers.png`,
`04-chat-2.png` — matching this order.

---

## 5. Permissions justification

The dashboard gives you **one textarea per permission** — so this section is one block per
field, in the order the form lists them. Each is written for a reviewer who has thirty seconds:
what it does here, and why nothing narrower works.

**`debugger`**

<div data-copy-block>

```
TabRunner clicks and types on the user's behalf. Chrome only produces trusted input events through
the DevTools Protocol; events dispatched from a content script are synthetic, and login forms,
payment fields and most modern web apps ignore them. TabRunner attaches to the single tab the
user's task is running in and detaches when the task ends. Chrome's "started debugging" banner
stays visible for the whole run, so the user always knows.
```

<button class="copy-btn" data-copy onclick="copyBlock(this)">⧉ Copy</button>

</div>

**`scripting`**

<div data-copy-block>

```
Injects the script that turns the current page into a compact accessibility tree (roles, names and
element references) for the AI model to read. This is what lets the model work without ever
receiving the page's raw HTML.
```

<button class="copy-btn" data-copy onclick="copyBlock(this)">⧉ Copy</button>

</div>

**`sidePanel`**

<div data-copy-block>

```
Hosts the extension's entire interface: the panel where the user writes a task, watches each step
as it happens, answers the agent's questions, and stops the run.
```

<button class="copy-btn" data-copy onclick="copyBlock(this)">⧉ Copy</button>

</div>

**`tabs`**

<div data-copy-block>

```
Reads the title and URL of the tab a task starts from, and switches to another open tab when the
task refers to one ("archive the email I was just reading"). Without it the agent cannot tell
which page it is working on, or return to a page the user already has open.
```

<button class="copy-btn" data-copy onclick="copyBlock(this)">⧉ Copy</button>

</div>

**`activeTab`**

<div data-copy-block>

```
Grants access to the tab the user submits a task from, at the moment they submit it.
```

<button class="copy-btn" data-copy onclick="copyBlock(this)">⧉ Copy</button>

</div>

**`tabGroups`**

<div data-copy-block>

```
A task the user sends to the background opens its own tab. TabRunner puts that tab in a labelled
tab group named after the task, so the user can see at a glance which tab the agent is working in
and close it in one action. Only groups TabRunner itself creates are touched.
```

<button class="copy-btn" data-copy onclick="copyBlock(this)">⧉ Copy</button>

</div>

**`storage`**

<div data-copy-block>

```
Stores the user's AI provider settings and their conversation history locally, in chrome.storage on
their own device. Nothing is uploaded — there is no TabRunner server.
```

<button class="copy-btn" data-copy onclick="copyBlock(this)">⧉ Copy</button>

</div>

**`notifications`**

<div data-copy-block>

```
Tasks run in their own background tab and keep working after the side panel closes. A
notification reports when a task finishes or fails, and when it pauses to ask the user a
question (for example, before sending something on their behalf). Fired only while the panel
is closed — never for runs the user stopped themselves.
```

<button class="copy-btn" data-copy onclick="copyBlock(this)">⧉ Copy</button>

</div>

**`alarms`**

<div data-copy-block>

```
TabRunner can optionally accept tasks from a local AI assistant on the user's own machine. Chrome
suspends the extension's service worker when idle, so a periodic alarm wakes it to re-establish
that local connection, and to keep the worker alive through a long task while the side panel is
closed. Alarms are only scheduled while the bridge feature is enabled or a task is in flight.
```

<button class="copy-btn" data-copy onclick="copyBlock(this)">⧉ Copy</button>

</div>

**`declarativeNetRequestWithHostAccess`**

<div data-copy-block>

```
Used only on TabRunner's own network requests to the AI provider the user configured — never on
pages the user visits or on the site being automated.

Providers that the user signs in to (rather than pasting an API key) reject requests that arrive
with a browser Origin header. TabRunner removes that header from its own calls so a subscription
sign-in works at all. The rule matches a fixed list of AI provider API hostnames, and modifies
only request headers on those hosts. It blocks nothing, redirects nothing, and reads no page.
```

<button class="copy-btn" data-copy onclick="copyBlock(this)">⧉ Copy</button>

</div>

**Host permissions (`<all_urls>`)**

<div data-copy-block>

```
The user decides which site the agent works on by typing a task in the side panel, so the set of
sites cannot be known in advance — it is whatever the user asks for, on the sites they are already
logged in to. The extension acts on a site only while a task is running on it. The only other
network destination is the AI provider the user configured.
```

<button class="copy-btn" data-copy onclick="copyBlock(this)">⧉ Copy</button>

</div>

**Single-purpose description**

<div data-copy-block>

```
TabRunner lets an AI model the user chooses carry out tasks in their own browser: reading a page,
clicking, typing and filling forms on the sites they are already signed in to, until the task they
described is done. Data goes to exactly two places — the site being worked on, and the AI provider
the user configured with their own credentials. There is no TabRunner server, no account, no
analytics, and no third-party network activity.
```

<button class="copy-btn" data-copy onclick="copyBlock(this)">⧉ Copy</button>

</div>

---

## 6. Privacy

CWS asks for a **single-purpose description** and a **privacy policy URL**. The policy lives in the
repo at [`PRIVACY.md`](../../PRIVACY.md), served on GitHub:

<div data-copy-block>

```
https://github.com/gusnips/tabrunner/blob/main/PRIVACY.md
```

<button class="copy-btn" data-copy onclick="copyBlock(this)">⧉ Copy</button>

</div>

Paste that URL into the **Privacy policy** field. (The store's "No privacy policy needed" path is
not available for extensions that handle personal data — we do process page content, so a policy
is required.) Keep `PRIVACY.md` in sync with the product the same way this doc is: when a feature
changes what's stored or sent, update the matching section.

Draft single-purpose description (paste into the privacy form):

<div data-copy-block>

> TabRunner lets an LLM the user configures drive their browser. It reads page content only while a
> task is running, sends it to the user's chosen provider, and stores conversation history and
> provider settings locally in Chrome. No server, no account, no data collection by TabRunner, no
> third-party sharing beyond the provider the user configured and the sites the task touches.

<button class="copy-btn" data-copy onclick="copyBlock(this)">⧉ Copy</button>

</div>

---

## 7. Resubmission checklist

A submission under review cannot change its permission set, so v0.1.0 comes out and a new
version goes in.

- [ ] **Withdraw v0.1.0**: dashboard → TabRunner → Package → **Cancel submission** (the item
      returns to Draft; the listing text, screenshots and store URL all survive)
- [ ] Gates green: `bun run compile && bun run lint && bun run test && bun run deadcode && bun run i18n:check`
- [ ] `bun run release minor` → bumps, commits, tags, and writes both zips
- [ ] Upload **`dist/tabrunner-<version>-store.zip`** — not `-chrome.zip`, which carries the
      manifest `key` the store rejects ("key field is not allowed in manifest"). Same build
      otherwise, so it carries the new `declarativeNetRequestWithHostAccess` permission
- [ ] Paste the **§5** justification for every permission — the new one especially; a permission
      added between submissions is the thing a reviewer looks at first
- [ ] Re-confirm the single-purpose description (§5) and the privacy policy URL (§6) survived
- [ ] Submit, then `git push --follow-tags` so the Action attaches the release's artifacts (the
      keyed `-chrome.zip` the website links, plus the CRX and the daemon bundle)

Unchanged since the first submission: title, descriptions, screenshots, privacy policy URL. The
extension ID is not — the item was recreated on 2026-08-10, so it is now
`ilnohobdcigbmlikjbkdpbkhciephdle` (the daemon's trusted set in `daemon/src/index.ts` tracks it).

### Once the listing is approved

The store item's id becomes the canonical one, so the manifest `key` (`wxt.config.ts`) can be
swapped from the CRX's public key to the store item's — dashboard → the item → **Package** → the
public key — after which dev and unpacked builds share real users' id and the MCP bridge's
expected id is right everywhere. Three things to know before doing it:

- `zip:store` stays. The store rejects a declared `key` even when it's the store's own.
- An id change is a storage reset for the self-hosted zip install: `chrome.storage` is per-id, so
  existing users would re-enter their provider config. Cheap now, expensive later.
- The locally signed CRX would then declare a key that disagrees with `tabrunner-test.pem` and
  stop installing. It's already unlinkable (Chrome blocks sideloaded CRX), so retire it in the
  same change rather than shipping a broken artifact.

Then update `EXPECTED_EXTENSION_ID` in `daemon/src/index.ts` and its row in `docs/mcp.md`.

**What changed in the product**, if a reviewer asks: providers the user _signs in to_ (their
existing Anthropic, OpenAI or Kimi subscription) now work alongside pasted API keys. That is the
whole reason for the new permission — see §5.
