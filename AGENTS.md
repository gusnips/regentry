# Regentry — Agent Guide

Provider-agnostic browser agent extension — lets an LLM drive your real browser with existing
logged-in sessions. Chromium-only (`chrome.debugger` has no Firefox/Safari equivalent).

## Commands

```bash
bun run dev        # dev mode with hot reload
bun run build      # production build → dist/chrome-mv3
bun run test       # vitest
bun run lint       # eslint
bun run compile    # tsc --noEmit
bun run format     # prettier
bun run deadcode   # knip (deadcode:fix to auto-fix)
bun run i18n:check # locale parity + every static t() key resolves (--unused for orphans)
bun run icons      # regenerate public/icon/* + docs/og.png from src/shared/logo.ts
bun run zip        # build + pack dist/regentry-<version>-chrome.zip
bun run crx        # build + sign a test CRX with regentry-test.pem (gitignored) → dist/regentry-<version>-test.crx
bun run release    # bun run release <patch|minor|major> — gates, bump, commit, tag, zip
bun run bridge     # run the MCP daemon by hand (clients spawn it themselves)
bun run bridge:check # end-to-end check of the MCP bridge — no Chrome needed
```

`daemon/` is a bun workspace, so one `bun install` covers both packages and `compile` typechecks
both.

Load: `chrome://extensions` → Developer mode → Load unpacked → `dist/chrome-mv3`.

Before submitting work: `compile`, `lint`, `test`, `deadcode`, `i18n:check` — all green.
(`compile` IS the typecheck — `tsc --noEmit`.)

## Releasing

The `version` in `package.json` is the single source of truth — the git tag (`v0.1.0`) and the
artifact (`dist/regentry-0.1.0-chrome.zip`) both derive from it.

```bash
bun run release minor   # gates → bump → commit "Release vX" → tag vX → zip; never pushes
```

Runs the full gate set first, so a gate failure writes nothing — no bump, commit, or tag. Publishing is
then manual: `git push --follow-tags`, upload the zip to the Chrome Web Store. The manifest
`version` comes from `package.json` automatically (WXT), so a tagged build and its zip always agree.

## Architecture

WXT (MV3) + React 19 + TypeScript + Tailwind 4 + Base UI (`@base-ui-components/react` — NOT
Uber's `baseui`) + zustand. Bun for everything.

Domain-first `src/modules/<domain>/`, mirroring featury's server modules. Each module has an
`index.ts` barrel and colocated `__tests__/`.

**Runtime boundary — one rule, no exemptions.** Within a domain, everything under `ui/` is
UI-only (including its zustand `store.ts`); everything else is background-safe. ESLint
`no-restricted-imports` forbids any file outside a `ui/` folder (plus `src/components/**`,
entrypoints, tests) from importing `react`, `react-dom`, `zustand`, or `*/ui/*` — so React can
never reach the service-worker bundle.

### Modules

- `agent/` — agent loop (stream → tool calls → results → repeat), tools, system prompt.
  The system prompt carries a consequential-action policy (paying, sending on the user's
  behalf, deleting, submitting need explicit permission), enforced through the `ask_user`
  tool: the run ends on a question the panel renders as a card with tappable choices, and
  the answer arrives as the next message. Background-only.
- `browser/` — accessibility-tree snapshot (injected script), CDP driver (trusted input),
  unified driver seam, on-page "Regentry is controlling this tab" badge plus a purple dot over
  the driven tab's favicon so the strip shows where a run is working — the dot pulses via
  frames pushed from the worker, because Chrome throttles hidden-tab timers and hidden is
  exactly when the strip signal matters. Background-only.
- `providers/` — OpenAI/Anthropic/Responses adapters, presets, storage, config UI (add/edit
  dialog, list, per-task header picker, first-run onboarding). Adding a provider is a data change
  in `presets.ts` — never a code change elsewhere. (A new WIRE SHAPE is the exception: adapter +
  factory case + `ProviderShape` union.)
- `conversation/` — stored conversations, message types, chat UI (MessageList, ChatInput,
  RunStatus, ConversationList). `transcript.ts` is the persistence half of the panel store's
  event handling, background-safe: one `TranscriptWriter` per run turns run events into stored
  messages. The panel store renders, the writer stores — two views of one event stream, and they
  must stay in lockstep.
- `bridge/` — the MCP bridge's extension half. Background-only. See the MCP bridge section below.
- `shared/` — Port protocol, shared types, brand mark (`logo.ts`).
- `src/components/` — cross-domain Base UI primitives: Button, Select, SegmentedControl,
  TextField, PasswordField, TextArea, ConfirmDialog, plus the ThemeToggle/LanguageToggle
  preference controls shared by the panel's gear menu and the options page, and the chat
  primitives adapted from shadcn's June-2026 drop: Bubble (framed message, house tokens)
  and MessageScroller (styled shells over `@shadcn/react`'s headless scroller).
- `src/i18n/` — the one i18next instance, the `en`/`pt-BR`/`es` catalogs, and typed keys.
  Not a `modules/` domain because every layer needs it, background included.
- `src/lib/` — storage helpers, logger, Tailwind theme tokens (`brand-*` purple scale).

### Data flow

| Channel                         | What                                         | Why                                                |
| ------------------------------- | -------------------------------------------- | -------------------------------------------------- |
| `wxt/utils/storage` + `watch()` | Settings, provider configs, conversations    | Cross-context pub/sub, zero messaging code         |
| Port (`runtime.connect`)        | Token deltas, step events, run/stop commands | Streaming; an open Port keeps the MV3 worker alive |

**Conversation storage** (`conversation/conversations.ts`): a `conversations` index of metadata
(id, title, counts, driven tabs) plus one `conversation:<id>` key per transcript — appending
rewrites a single transcript, never the whole store. The panel writes through `appendMessage`,
which resolves the active id itself, so the background worker can append (e.g. the panel-closed
breadcrumb) without knowing which conversation is open. Every write is read-modify-write and the
panel fires them from an event stream, so `appendMessage`/`replaceMessage` are **serialized** on
one promise chain — concurrent appends otherwise read the same array and the last write wins.
`sendTask` **awaits** its user message before posting `run`: the worker builds the run's history
by reading the transcript, and a fire-and-forget write loses that race every time. A fresh conversation is created lazily by
its first message, so "New chat" never leaves an empty row behind. The transcript doubles as the
model's memory, strictly per conversation: at run start the background rebuilds _that_
conversation's transcript as alternating user/assistant wire turns (`buildConversationHistory`
in `agent/history.ts`) — entries capped, a total char budget spent newest-first, the original task
always kept — and replays it ahead of the new task message, so "continue" lands on a model that has read the same
exchange. A new chat starts clean; the only context that crosses chats is AGENTS.md / MEMORY.md.
Steps and reasoning stay out of it; outcomes live in the assistant's own words, ask_user
questions included. Conversations remain scrollback you can revisit and delete.

**Tabs belong to messages, not to the conversation.** One run per message, and the user moves
between messages: each user message is stamped with the tab it was sent from (shown in the
transcript once the conversation spans more than one tab), and the conversation keeps the tabs its
runs drove — deduped by url, newest first, capped. A run starts on the submit-time active tab; the
task message names any stored tabs the user is not on, so "that email" and "the doc" can find
their way back via list_tabs/switch_tab.

## MCP bridge

Lets an external AI client (Claude Code, Claude Desktop) drive the same agent loop the panel
drives. Human-facing docs: [docs/mcp.md](docs/mcp.md).

**The extension is always the WS client** — an MV3 service worker cannot listen on a socket, so it
can never be an MCP server itself. It dials `ws://127.0.0.1:<port>/ws`; `daemon/` accepts, and
speaks MCP over stdio to the client. Two hops, one direction of dialling, no way around it.

**A thin front over the existing loop, not a second tool catalog.** The client sends one task;
`bridge.ts` hands it to the same `startAgentRun` the panel uses. Model resolution, conversation
memory, ask_user, screenshots and done-summary semantics all come for free, and can never drift
from the panel's.

- **One run, one slot.** `agent/active-runs.ts` holds a single `ActiveRun` tagged `panel` or
  `bridge`; only its owner may stop or steer it. Whoever asks second gets an error naming the
  holder — that's what `errors.alreadyRunningMCP` / `alreadyRunningPanel` are for.
- **The bridge owns its own conversation**, created lazily and reset by `newConversation`. It never
  touches the panel's active thread, but it shows up in history like any other.
- **Compact events only.** Tokens, reasoning and usage never cross the WS; `bridge/status.ts` folds
  the run's events into a `BridgeStatus` and forwards only structural changes. The daemon runs the
  same reduction over that compact stream (`daemon/src/protocol.ts` `applyCompact`) so
  `get_status(wait)` can long-poll — one MCP turn per real event, not per poll.
- **The status is mirrored, not owned, on the daemon side.** On every `hello` the daemon issues
  `sync` and takes the extension's answer as truth. A dropped link doesn't stop the run; a
  suspended worker does, and shows up as a run that vanished across the resync.
- **The protocol is declared twice on purpose** — `src/modules/bridge/protocol.ts` (source of
  truth) and `daemon/src/protocol.ts`. The daemon is a standalone bun package and must not import
  from the extension bundle. Change them together, then `bun run bridge:check`.
- **MV3 timing.** `BridgeSocket.start()` is synchronous: a listener registered after an `await`
  is silently dropped by Chrome, and the reconcile alarm is the whole point of the class. One
  `reconcile()` owns the whole decision — it arms the alarm when enabled and clears it when not,
  so a disabled bridge costs nothing. Only a WS that actually opened earns the 2s fast retry; a
  refused connect (the normal case — almost nobody runs the daemon) waits for the alarm.

**Direct control** (`bridge/direct.ts`) is the other half: a client that would rather drive than
delegate calls `browser_start(goal)` and then the `browser_*` verbs.

- **Same `executeTool`, same driver.** The MCP verbs map 1:1 onto agent tool names, so there is
  one browser implementation and no second catalog. Discrete tools at the MCP surface (the shape
  models know), one `browserAct` method on the wire.
- **A session holds the run slot**, so direct driving and an agent run can never fight over a tab.
  It expires after 5 idle minutes rather than locking the user out of their own panel.
- **Mutating actions re-snapshot.** A ref belongs to the snapshot that produced it, so acting on a
  stale ref is a correctness bug — every mutating verb returns the fresh page with its result.
- **No ask_user.** The consequential-action policy lives in the system prompt, which direct control
  bypasses; the client carries it (tool descriptions + SKILL.md), and PRIVACY.md says so plainly.
  The compensations are visibility: badge, tab dot, and a stored transcript.
- **The thread is the goal.** `browser_start` opens its own conversation and writes the goal as its
  first user message, so the existing "title = first user message" rule names it. `ConversationMeta.agent`
  carries the client name (from MCP `initialize`), which history shows as a chip — a transcript the
  user never started must say where it came from.

## Provider wire contracts (the load-bearing details)

- **Anthropic rejects consecutive same-role messages.** Tool results go back as ONE user message
  with N `tool_result` blocks; OpenAI expands to N separate `role: "tool"` messages. The shared
  `ChatMessage` shape is `role: "tool_results"` + `toolResults[]`; each adapter serializes its
  own way (`buildOpenAIBody` / `buildAnthropicBody` — exported, unit-tested).
- **Auth headers:** Anthropic reads `x-api-key`; coding-plan proxies (Kimi, Z.ai, QwenCloud)
  read `Authorization: Bearer`. The Anthropic adapter sends both.
- **Usage:** OpenAI via `stream_options: {include_usage: true}`; Anthropic via
  `message_start`/`message_delta`. Both adapters emit `{type:"usage"}` deltas.
- **No sampling params.** Never send temperature/topP — provider defaults always apply. The one
  knob we expose is `reasoningEffort` (`none|low|medium|high|max`, optional): verbatim
  `reasoning_effort` on OpenAI-shape; `thinking: {type:"adaptive"}` + `output_config: {effort}`
  on Anthropic-shape (`none` = adaptive only, Anthropic has no off switch). Unsupported levels
  come back as a clean provider 400, surfaced in chat — we never sniff model names.
- **Images are data URLs everywhere inside Regentry**, split per wire format at the adapter edge.
  Anthropic nests image blocks inside the `tool_result` itself; an OpenAI-shape `role:"tool"`
  message is text-only, so that adapter trails a `user` message carrying the images. The agent
  loop keeps only the newest `MAX_ATTACHED_IMAGES` screenshots attached (every image is re-sent
  on every later turn); a user's own attachment is never pruned. Screenshots are JPEG q80 from
  `Page.captureScreenshot` and are stripped before storage — user attachments persist.
- **The ChatGPT subscription provider is a `responses` shape** (`responses.ts`), streaming the
  Codex backend's `POST {base}/responses` — it exposes no chat-completions surface. Auth is a
  Bearer access token PLUS the `ChatGPT-Account-Id` header (extracted from the JWT at sign-in as
  `OAuthCredential.chatgptAccountId`; re-extracted on refresh, so it never goes stale).
  Reasoning (`reasoning_summary_text`/`reasoning_text` deltas) is displayed but NEVER replayed —
  the backend requires it blanked. Tool results with screenshots use the codex-rs content-array
  form (`output: [{input_text, input_image}]`); text-only results stay a plain string.
  `reasoningEffort` maps to `reasoning: {effort}` (`none` omits the knob — codex models have no
  off switch).
- **Stream retry** happens in place (agent loop) with full-jitter backoff, only while nothing
  has been emitted yet — the UI never sees replayed tokens.
- **Stop is not an error.** User abort is normal control flow: the loop ends with `done`, never
  a red bubble. The `done` event carries the model's final summary — on tool-only final turns it
  IS the answer, so the panel renders it when no text was streamed.
- **Model lists are live, presets are fallback.** `listModels` (`models.ts`) reads
  `GET {base}/v1/models` (Anthropic-shape) or `GET {base}/models` (OpenAI-shape, non-chat ids
  filtered). `ProviderConfig.model` is optional — absent means auto, resolved at run start by
  `resolveProviderModel`: persisted choice → newest listed (by `created`) → preset's first →
  clear error. QwenCloud has no list route; that's why presets keep model ids at all. The ChatGPT
  backend (responses shape) has NO list route either — `listModels` short-circuits to `[]`, so
  the preset models ARE the picker's list. Endpoints
  that ship a human label (Anthropic `display_name`, OpenRouter `name`) get it in `ModelInfo.name`
  and the picker shows it; the id stays the value on the wire and in the tooltip. Model and
  effort are per-task choices in the side-panel header selects, persisted per provider — never asked
  for at provider-setup time (the key doesn't exist yet, so the list can't be fetched there).
  The "Auto" option renders the model it currently resolves to, tagged with an `Auto` chip.

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
