# Regentry — Chrome Web Store listing

Source of truth for the store submission. Copy-paste from the blocks below into the CWS dashboard
(`chrome.google.com/webstore/devconsole` → Regentry → **Store listing**). Everything here is kept in
sync with the product; when a feature lands, update the matching block and re-submit.

> Status: **draft for v0.1.0.** Screenshots pending (Gus captures them — see
> [Screenshots](#screenshots)). Permissions justification and privacy notes verified against
> `wxt.config.ts` and `README.md`.

---

## 1. Identity

| Field | Value |
| --- | --- |
| **Name** | Regentry |
| **Category** | Productivity |
| **Language** | English (listing is localized: en / pt-BR / es shipped in `public/_locales/`) |
| **Visibility** | Public |
| **Support URL** | https://github.com/gusnips/regentry/issues |
| **Homepage URL** | https://github.com/gusnips/regentry |

**Title field** (≤ 45 chars) — use the plain name, it's the strongest brand:

```
Regentry
```

---

## 2. Short description (≤ 132 characters)

Use this string (109 chars — comfortable headroom under the 132 limit):

```
An AI agent that drives your real browser — your tabs, sessions and logins — through any provider you choose.
```

> Verify in the dashboard (it shows a counter). All three localized variants are also under the cap.

**Localized short descriptions** (same 132-char cap each):

- **Português (Brasil):**
  ```
  Um agente de IA que dirige seu navegador de verdade — abas, sessões e logins — com qualquer provedor que você escolher.
  ```
- **Español:**
  ```
  Un agente de IA que maneja tu navegador real — pestañas, sesiones y accesos — con el proveedor que elijas.
  ```

---

## 3. Full description

Markdown-friendly subset: `##`/`###`, `**bold**`, `-` lists, links. CWS renders headings as
sections. Paste as-is.

````markdown
## Your browser, commanded

Regentry is a browser agent that lives in your browser and works in it — not in a sandbox. It
opens your tabs, uses your logged-in sessions, and reads, clicks and types on the sites you
already use, until the task you described is done.

- **Works in your real browser** — your existing logins are its sessions. No setup on every site,
  no fake profile, no separate account.
- **Bring your own provider** — 12 presets (Anthropic, OpenAI, DeepSeek, Kimi, Z.ai, Qwen, Gemini,
  OpenRouter, Groq, Mistral, xAI, Ollama) plus any endpoint speaking the OpenAI or Anthropic wire
  format. No vendor lock-in, no relay, no Regentry server.
- **Your keys stay yours** — the API key goes straight from the extension to your provider.
  Nothing is stored outside Chrome. No account, no telemetry.
- **Trusted input** — clicks and keystrokes go through the Chrome DevTools Protocol, so they are
  genuine trusted events, not synthetic dispatches sites can ignore.
- **See the work** — a live plan, current action, token spend and elapsed time while the agent
  runs, Claude Code-style. Every step is logged in the conversation.

## How it works

1. Describe a task in the side panel — e.g. "open my inbox and summarize the last 3 emails".
2. Regentry reads the page's accessibility tree and lets the model drive the tab: navigate,
   click, type, scroll, screenshot — as real user input.
3. Watch it work, step by step. Hit **Stop** at any time — queued messages run as the next task.

## Private by design

- No Regentry server exists. The extension speaks to your provider directly.
- Provider configs and conversation history live in `chrome.storage` on this device.
- The model never receives raw HTML — it works from a compact semantic tree of the page, and
  sensitive fields (passwords, card numbers) never leave the page.
- Works on Chrome, Brave, Edge, Arc, Opera and Vivaldi.

## Guardrails

- **Ask before acting** — consequential actions (paying, sending, deleting) ask for your
  confirmation in the panel before they happen.
- **Stop is real** — closing the panel or pressing Esc stops the agent. No zombie clicking.
- **Reasoning effort** — pin `none` → `max` per task, or leave Auto and Regentry runs the newest
  model your endpoint lists.

## Languages

English · Português (Brasil) · Español. Light and dark theme, or follow your OS.
````

---

## 4. Screenshots

CWS requirements: **1280×800** or **640×400**, PNG or JPEG, 1–5 images, the first is the card image.
The panel and options pages are Regentry's own `chrome-extension://` pages, so they are never
"debugged" and capture without any browser warning bar — no workaround needed.

Recommended set (in this order):

1. **Side panel over a neutral page** (hero) — the panel open on a real site you're logged into
   (or Wikipedia), with a completed run visible. 1280×800.
2. **Task running** — the panel mid-run: plan card, tool steps, token/elapsed live. 1280×800.
3. **Provider settings** — the options page with the provider list. 1280×800.
4. **Add-provider dialog** — the custom endpoint form (OpenAI/Anthropic shape picker). 640×400.
5. **(Optional) Dark theme** — any of the above with dark mode on, to show theming. 640×400.

Capture recipe:

1. Build and load: `bun run build` → `chrome://extensions` → Developer mode → **Load unpacked** →
   `dist/chrome-mv3`.
2. Click the **Regentry** toolbar icon to open the side panel.
3. Set the window so the page + panel read well, then capture at exactly 1280×800. Preferred:
   Brave's `--window-size=1280,800`, or crop a larger capture down.
4. For dark-theme shots, toggle the theme in the panel's gear menu first.

Saved in `docs/screenshots/` as `01-side-panel.png`, `02-running.png`, `03-providers.png`,
`04-add-provider.png` — matching this order.

---

## 5. Permissions justification

Paste into the **Permission justification** section. (CWS shows this to reviewers; be precise.)

| Permission | Justification |
| --- | --- |
| `debugger` | Required for trusted input — clicks and keystrokes are dispatched over the Chrome DevTools Protocol, the only way to produce real (trusted) events a site can't ignore. |
| `scripting` | Injects the accessibility-tree snapshot script into the tab the agent reads. |
| `sidePanel` | Hosts the chat UI where the user writes tasks and watches the agent run. |
| `tabs` | Reads the active tab's URL/title and switches tabs when a task references another open tab. |
| `activeTab` | Grants access to the tab the user submits a task from, per action. |
| `storage` | Persists provider configs and conversation history locally in `chrome.storage`. |
| `notifications` | Alerts the user when the agent needs their input while Chrome is not focused. |
| Host permissions (`<all_urls>`) | The agent must be able to navigate, read, and interact with any site the user asks it to use. No network calls are made beyond the user's configured provider and the site itself. |

**Single-purpose disclosure:** the extension exists solely to let a user's chosen LLM drive their
browser on their behalf. It sends data only to the site being driven and to the user-configured
provider (via their own API key). There is no Regentry server, no analytics, no third-party
network activity.

---

## 6. Privacy

CWS asks for a **single-purpose description** and a **privacy policy URL**. No privacy policy page
exists yet — decide with Gus before submitting. Options: a short `PRIVACY.md` served on GitHub
(`https://github.com/gusnips/regentry/blob/main/PRIVACY.md`), or the store's "No privacy policy
needed" path is **not** available for extensions that handle personal data — we do process page
content, so a policy is expected.

Draft single-purpose description (paste into the privacy form):

> Regentry lets an LLM the user configures drive their browser. It reads page content only while a
> task is running, sends it to the user's chosen provider, and stores conversation history and
> provider settings locally in Chrome. No server, no account, no data collection by Regentry, no
> third-party sharing beyond the provider the user configured and the sites the task touches.

---

## 7. Pre-submit checklist

- [ ] `bun run compile && bun run lint && bun run test && bun run deadcode && bun run i18n:check` — all green
- [ ] Screenshots captured at 1280×800 / 640×400, saved to `docs/screenshots/`, approved by Gus
- [ ] Short description verified ≤ 132 chars
- [ ] Privacy policy URL decided (see §6)
- [ ] Zip built from the exact release being submitted: `bun run release <patch|minor|major>`
      → `dist/regentry-<version>-chrome.zip`
- [ ] The zip uploaded to CWS matches the git tag's artifact (same build, same version)
- [ ] Push and let the GitHub Action attach the zip to the release: `git push --follow-tags`
