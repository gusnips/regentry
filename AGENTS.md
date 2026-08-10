# TabRunner — Agent Guide

Provider-agnostic browser agent extension — lets an LLM drive your real browser with existing
logged-in sessions. Chromium-only (`chrome.debugger` has no Firefox/Safari equivalent).

## Commands

```bash
bun run dev        # dev mode with hot reload
bun run build      # production build → dist/chrome-mv3
bun run test       # vitest
bun run lint       # eslint
bun run compile    # tsc --noEmit (this IS the typecheck)
bun run format     # prettier
bun run deadcode   # knip (deadcode:fix to auto-fix)
bun run i18n:check # locale parity + every static t() key resolves (--unused for orphans)
bun run icons      # regenerate public/icon/* + docs/og.png from src/shared/logo.ts
bun run shots      # store screenshots → docs/screenshots/ (+ site sync when ../site exists)
bun run shots:ui   # light/dark UI previews → preview/ (gitignored)
bun run zip        # build + pack dist/tabrunner-<version>-chrome.zip (the website's download)
bun run zip:store  # same build minus the manifest `key` → dist/tabrunner-<version>-store.zip (CWS)
bun run crx        # build + sign the public CRX with tabrunner-test.pem (gitignored)
bun run release    # bun run release <patch|minor|major> — gates, bump, commit, tag, zip
bun run bridge     # run the MCP daemon by hand (clients spawn it themselves)
bun run bridge:check # end-to-end check of the MCP bridge — no Chrome needed
bun run bridge:bundle # single-file daemon → dist/tabrunner-<version>-mcp.js (what releases ship)
```

`daemon/` is a bun workspace, so one `bun install` covers both packages and `compile` typechecks
both.

Load: `chrome://extensions` → Developer mode → Load unpacked → `dist/chrome-mv3`.

Before submitting work: `compile`, `lint`, `test`, `deadcode`, `i18n:check` — all green.

## Releasing

`version` in `package.json` is the single source of truth; the git tag and artifacts derive from
it (the manifest version comes from WXT automatically).

```bash
bun run release minor   # gates → bump → commit "Release vX" → tag vX → zips + crx; never pushes
```

A gate failure writes nothing. Publishing is manual: `git push --follow-tags`, upload
`dist/tabrunner-<version>-store.zip` to the Chrome Web Store. **Two zips ship per version and
they are not interchangeable**: `-chrome.zip` carries the manifest `key` — the store listing's own
public key, which is what pins the unpacked install from tabrunner.app and every dev build to the
one id (`ilnohobdcigbmlikjbkdpbkhciephdle`), per
[Chrome's consistent-ID guidance](https://developer.chrome.com/docs/extensions/reference/manifest/key).
`-store.zip` is the same build with that field dropped. The store never needs it (it derives the
id from the item record) and its validator rejects a new item's first upload outright ("key field
is not allowed in manifest"), so stripping is the one path that always uploads. The pushed tag fires `.github/workflows/release.yml`, which attaches
versioned artifacts plus `tabrunner-latest-*` aliases that tabrunner.app hotlinks (and the MCP
daemon bundle, `tabrunner-latest-mcp.js`, that Settings → MCP points users at). CI signs the
CRX with the `CRX_SIGNING_KEY` secret, which must hold the local `tabrunner-test.pem` verbatim —
a mismatched key splits installs across two extension IDs; the CI-built CRX is canonical. The
website contract lives in `docs/website-brief.md` — change it and the site repo (`../site`)
together.

## Architecture

WXT (MV3) + React 19 + TypeScript + Tailwind 4 + Base UI (`@base-ui-components/react` — NOT
Uber's `baseui`) + zustand. Bun for everything.

Domain-first `src/modules/<domain>/`. Each module has an `index.ts` barrel and colocated
`__tests__/`.

**Runtime boundary — one rule, no exemptions.** Within a domain, everything under `ui/` is
UI-only (including its zustand `store.ts`); everything else is background-safe. ESLint
`no-restricted-imports` forbids any file outside a `ui/` folder (plus `src/components/**`,
entrypoints, tests) from importing `react`, `react-dom`, `zustand`, or `*/ui/*` — so React can
never reach the service-worker bundle.

### Modules

- `agent/` — agent loop, tools, system prompt, run slot + FIFO queue, run start. Panel runs
  **work the user's current tab by default** — adopt it, group it under the task's name,
  drive it (the plan gate protects a page the user didn't want touched). It opens its own
  tab only when there's no page to work: blank/new-tab, a restricted page, an MCP client,
  or an explicit URL. Runs survive panel close.
  Action tools
  are gated on user-approved plans; `ask_user` enforces the consequential-action policy.
- `browser/` — accessibility-tree snapshot, CDP driver (trusted input), on-page badge + pulsing
  favicon dot on the driven tab, `restricted-url.ts`, `status-widget.ts`. Background-only.
- `providers/` — OpenAI/Anthropic/Responses adapters, presets, storage, config UI. Adding a
  provider is a data change in `presets.ts` — never a code change elsewhere.
- `conversation/` — stored conversations, message types, chat UI. The worker owns transcript
  persistence (`TranscriptWriter`); the panel store only renders. Whenever a run ends without
  a summary of its own — an error, or a user stop — the writer appends a deterministic progress
  note (`progress-note.ts`), so the work still reaches the next run's history.
- `memory/` — the two storage-backed markdown docs every run loads, mirroring the AGENTS.md /
  MEMORY.md convention: `AGENTS.md` is the user's standing instructions, `MEMORY.md` is the
  agent's, written by the `remember` tool. On by default (`memoryEnabled`); off stops both halves
  and the tool is not offered to the model at all. After a run, `extractAndRemember` distills
  durable facts from the transcript — capped at 3, and "none" is the expected answer, since a run
  that only read a page teaches nothing. Edited on the options page (no filesystem in an
  extension — the filenames are the mental model, not a path).
- `bridge/` — the MCP bridge's extension half. Background-only.
- `tips/` — the rotating "Tip: …" line; i18n data + cooldown scheduler (panel opens,
  least-recently-shown wins, re-picked on panel open / run end). Shows in the running run band,
  or on its own full-width row above the composer input when idle — never sharing the footer row
  with the run-target select. Shipping a user-facing gesture, shortcut, or tucked-away control?
  Add a tip with it: id + cooldown in `registry.ts`, copy in all three `tips.*` catalogs. Keep the
  copy short — one idea, ≤ ~90 chars; `TipLine` clamps at two lines, so a tip that needs more is
  two tips.
- `shared/` — Port protocol, shared types, brand mark (`logo.ts`).
- `src/components/` — cross-domain Base UI primitives (Button, Select, TextField, dialogs…)
  plus the chat Bubble/MessageScroller shells over `@shadcn/react`.
- `src/i18n/` — the one i18next instance, the `en`/`pt-BR`/`es` catalogs, and typed keys.
  Not a `modules/` domain because every layer needs it, background included.
- `src/lib/` — storage helpers, logger, Tailwind theme tokens (`brand-*` comet-burn emerald scale,
  indigo-tinted neutrals; the `telemetry` utility = gold, for anything that
  measures — elapsed, tokens, the plan step in flight. Emerald acts, gold measures;
  never pick an `amber-*` shade by hand for a measurement.

### Data flow

| Channel                         | What                                         | Why                                                |
| ------------------------------- | -------------------------------------------- | -------------------------------------------------- |
| `wxt/utils/storage` + `watch()` | Settings, provider configs, conversations    | Cross-context pub/sub, zero messaging code         |
| Port (`runtime.connect`)        | Token deltas, step events, run/stop commands | Streaming; an open Port keeps the MV3 worker alive |

Conversations: a `conversations` metadata index + one `conversation:<id>` key per transcript;
writes are serialized on one promise chain; the transcript is the model's per-conversation
memory (`buildConversationHistory`); the `read_history` tool pages the full transcript mid-run.
Tabs belong to messages, not to the conversation.

## Deep-dive docs

These carry the full rationale and invariants — read the one for the area you're touching:

- [docs/agent/architecture.md](docs/agent/architecture.md) — module internals: run lifecycle,
  plan gate, ask_user, status widget, OAuth/sign-in, conversation storage, tabs-per-message.
- [docs/agent/bridge.md](docs/agent/bridge.md) — MCP bridge internals: WS direction, run queue,
  compact events, daemon mirror, dual protocol declaration, MV3 timing, direct control.
- [docs/agent/providers.md](docs/agent/providers.md) — provider wire contracts: tool-result
  shapes, auth headers, reasoning effort, image/screenshot handling, body pruning, model lists.
- [docs/mcp.md](docs/mcp.md) — human-facing MCP setup docs.

Quick invariants that bite often:

- **Protocol declared twice on purpose**: `src/modules/bridge/protocol.ts` (source of truth) and
  `daemon/src/protocol.ts`. Change them together, then `bun run bridge:check`.
- **Stop is not an error**: user abort ends a run with `done`, never a red bubble.
- **No sampling params** (temperature/topP) on any provider — the only knob is `reasoningEffort`.
- **A question in plain prose does not pause a run** — only the `ask_user` tool does.

## Conventions

- TypeScript strict, `noUncheckedIndexedAccess`, `verbatimModuleSyntax` — `import type` for
  type-only imports (ESLint-enforced).
- No `any` in production code (ESLint-enforced). Fix the underlying type mismatch instead.
- No deprecated aliases or compatibility shims — clean breaks, fix the real problem.
- Prettier: 2-space, double quotes, semicolons, width 100.
- `@/*` alias → `src/*` (via `srcDir: "src"` in wxt.config.ts — WXT owns the `@` default).
- Base UI for interactive primitives — go through `src/components/`, don't hand-roll buttons,
  selects, inputs, or dialogs.
- i18n: no user-visible string is a literal — `useTranslation()` in UI, `i18n.t` elsewhere
  (`src/i18n` is React-free so the service worker translates too). Keys are typed off `en.json`,
  so a missing key is a compile error; add to **all three** catalogs in the same edit and run
  `i18n:check`. The panel's UI entrypoints must `await initUiI18n()` **before** `render` —
  `useTranslation` suspends forever on an uninitialized instance, which renders a blank panel.
  Extension metadata (name, description, action tooltip) is separate: `public/_locales/<lang>/`
  - `__MSG_*__` in `wxt.config.ts`, and Chrome wants `pt_BR`, not `pt-BR`.
- Theming: class-strategy dark mode (`@custom-variant dark` in `src/lib/theme.css`) — every color
  utility needs a `dark:` counterpart. The preference lives in `src/lib/theme.ts` (`themeMode`
  item, default `"system"`; `initTheme()` runs once per entrypoint, before render).
- Every error and empty state must orient and offer a way forward — Problem · Cause · Fix for
  errors; Purpose · Content · Action for empty states. Never a raw error or a bare "no results".
  Raw JSON error bodies go behind a Details disclosure (`splitErrorDetail` in
  `conversation/error-detail.ts`).
- Log via scoped loggers (`createLogger("<scope>")` from `src/lib/logger.ts`) — never raw
  `console.*`. Lifecycle at `info` (Chrome hides `debug` unless Verbose is on), chatter at
  `debug`. Never log API keys or page content; bound long strings with `truncate()`.
- Non-trivial logic leaves one runnable check behind (a small vitest file — no frameworks, no
  fixtures).
- Brand assets are generated: edit `src/shared/logo.ts`, run `bun run icons`. Never hand-edit
  `public/icon/*`.
