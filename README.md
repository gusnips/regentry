# Regentry

<p>
  <img src="public/icon/128.png" width="64" height="64" alt="Regentry crown mark" align="left" />
  <strong>Your browser, commanded.</strong><br/>
  A Chromium extension that lets an LLM drive your <em>real</em> browser — your tabs, your
  sessions, your logged-in accounts — through any provider you choose. You describe a task in the
  side panel; Regentry reads pages, clicks, types, and navigates until the job is done.
</p>

<br/>

> Named for the one who rules in your stead: Regentry acts with your authority, in your browser,
> while you watch.

## Why

Most browser agents run in a sandboxed, logged-out browser. Regentry runs in **yours** — so it can
act on the sites you're actually logged into. And it's provider-agnostic by construction: no
vendor lock-in, no relay, no account with us. Your API key goes straight from the extension to
your provider.

## Features

- **Bring your own provider** — 12 presets (Anthropic, OpenAI, DeepSeek, Kimi Coding, Z.ai Coding,
  Qwen, Gemini, OpenRouter, Groq, Mistral, xAI, Ollama) plus any custom endpoint speaking the
  OpenAI or Anthropic wire format.
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
- **Auto model resolution** — leave the model on Auto and Regentry runs the newest model the
  endpoint lists, showing you which one that is; pin a model and effort per task from the panel
  header.
- **Speaks your language, matches your theme** — English, Português (Brasil), and Español; light,
  dark, or follow the OS.
- **Your data stays local** — provider configs and history live in `chrome.storage`. There is no
  Regentry server.

## Install

```bash
bun install
bun run build
```

Then `chrome://extensions` → **Developer mode** → **Load unpacked** → select
`dist/chrome-mv3`. Click the Regentry toolbar icon to open the side panel, add a provider
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

1. You send a task. The background worker snapshots the active tab's accessibility tree.
2. The provider streams a reply; tool calls (`navigate`, `click`, `type`, `scroll`, `snapshot`,
   `screenshot`, `done`) execute against the real tab.
3. Results feed back into the conversation until the model calls `done` — or you hit Stop.

An open Port keeps the MV3 service worker alive for the whole run; durable state is written to
storage as it changes, so closing the panel never loses the conversation (it does stop the agent —
no zombie clicking with nobody watching).

## Development

```bash
bun run dev        # watch mode with hot reload
bun run test       # vitest
bun run lint       # eslint
bun run compile    # tsc --noEmit
bun run deadcode   # knip
bun run icons      # regenerate extension icons + OG card from src/shared/logo.ts
```

Domain-first layout under `src/modules/` (agent, browser, providers, conversation), UI primitives
in `src/components/` (Base UI + Tailwind 4). See [AGENTS.md](AGENTS.md) for the full architecture
and conventions.

## License

[MIT](LICENSE) © Gus
