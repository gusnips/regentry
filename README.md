# TabRunner

<p>
  <img src="public/icon/128.png" width="64" height="64" alt="TabRunner comet mark" align="left" />
  <strong>You decide. It does the legwork.</strong><br/>
  A Chromium extension that lets an LLM drive your <em>real</em> browser — your tabs, your
  sessions, your logged-in accounts — through any provider you choose. You describe a task in the
  side panel; TabRunner reads pages, clicks, types, and navigates until the job is done.
</p>

<br/>

> Named for what it does: it runs your tabs. You give it the goal, it does the legwork — in your
> browser, with your authority, while you watch.

## Why

Most browser agents run in a sandboxed, logged-out browser. TabRunner runs in **yours** — so it can
act on the sites you're actually logged into. And it's provider-agnostic by construction: no
vendor lock-in, no relay, no account with us. Your API key — or the subscription you sign in with
— goes straight from the extension to your provider.

## Features

- **Bring your own provider** — 15 presets (Anthropic, OpenAI, Kimi, Z.ai, Qwen, DeepSeek,
  Gemini, OpenRouter, Groq, Mistral, xAI, Ollama; Anthropic, OpenAI and Kimi each sign in with a
  subscription) plus any custom endpoint speaking the OpenAI or Anthropic wire format.
- **Real trusted input** — clicks and keystrokes go through the Chrome DevTools Protocol, so they
  are genuine trusted events, not synthetic JS dispatches that sites can ignore.
- **Accessibility-tree snapshots** — the model sees a compact semantic tree
  (`[ref=e12] button "Submit"`), not raw HTML. Small prompts, stable refs, sensitive fields
  (passwords, card numbers) never leave the page.
- **Agent loop with guardrails** — streamed tool calls, automatic retry with backoff on transient
  provider errors, a step budget, truncation detection, and a Stop button that actually stops.
- **Live run status** — current action, elapsed time, and token spend while the agent works,
  Claude Code-style.
- **Reasoning effort control** — optional per-provider effort (`none` → `max`), mapped to each
  wire format; omitted entirely when you want provider defaults.
- **Auto model resolution** — leave the model on Auto and TabRunner runs the newest model the
  endpoint lists, showing you which one that is; pin a model and effort per task from the panel
  header.
- **Drivable over MCP** — Claude Code, Claude Desktop, or any Model Context Protocol client can
  hand TabRunner a task and follow it to the answer, using the same browser and the same logins.
  The client says what it wants done and TabRunner's own model does it — or, when the job is small
  and exact, the client takes the wheel and clicks through the page itself. Either way it lands in
  your history, labelled with which client did it. See [docs/mcp.md](docs/mcp.md).
- **Speaks your language, matches your theme** — English, Português (Brasil), and Español; light,
  dark, or follow the OS.
- **Your data stays local** — provider configs and history live in `chrome.storage`. There is no
  TabRunner server. See [PRIVACY.md](PRIVACY.md) for the full picture.

## Install

```bash
bun install
bun run build
```

Then `chrome://extensions` → **Developer mode** → **Load unpacked** → select
`dist/chrome-mv3`. Click the TabRunner toolbar icon to open the side panel, add a provider
(options page), and describe a task.

Works on Chrome, Brave, Edge, Arc, Opera, and Vivaldi. Chromium-only by design: Firefox has no
`chrome.debugger` equivalent ([Bugzilla 1316741](https://bugzilla.mozilla.org/show_bug.cgi?id=1316741)),
which trusted input depends on.

## How it works

```
side panel (React) ──Port──▶ background service worker ──▶ provider API (SSE stream)
                                  │
                                  ├─▶ snapshot: accessibility tree via chrome.scripting
                                  └─▶ actions: trusted input via chrome.debugger (CDP)
```

1. You send a task. The background worker opens its own background tab (or drives the current
   one when you ask for "this page") and snapshots its accessibility tree.
2. The provider streams a reply; tool calls (`navigate`, `click`, `type`, `scroll`, `snapshot`,
   `screenshot`, `done`) execute against the real tab.
3. Results feed back into the conversation until the model calls `done` — or you hit Stop.
   One task runs at a time; the next submissions wait in a serial queue.

An open Port keeps the MV3 service worker alive while the panel is open; with the panel closed
(after a background submit it closes itself) a periodic alarm holds it through long silences.
Durable state is written to storage as it changes, and runs keep working with the panel closed —
stop them from the Run Board, the floating widget, or by closing the driven tab.

## Development

```bash
bun run dev           # watch mode with hot reload
bun run test          # vitest
bun run lint          # eslint
bun run compile       # tsc --noEmit (extension + daemon)
bun run deadcode      # knip
bun run icons         # regenerate extension icons + OG card from src/shared/logo.ts
bun run bridge        # run the MCP daemon by hand
bun run bridge:check  # end-to-end check of the MCP bridge, no Chrome needed
```

Domain-first layout under `src/modules/` (agent, browser, providers, conversation), UI primitives
in `src/components/` (Base UI + Tailwind 4). See [AGENTS.md](AGENTS.md) for the full architecture
and conventions.

## License

[MIT](LICENSE) © Gus
