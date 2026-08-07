# Regent — Agent Guide

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
bun run icons      # regenerate public/icon/* + docs/og.png from src/shared/logo.ts
```

Load: `chrome://extensions` → Developer mode → Load unpacked → `dist/chrome-mv3`.

Before submitting work: `compile`, `lint`, `test`, `deadcode` — all green.

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
  Background-only.
- `browser/` — accessibility-tree snapshot (injected script), CDP driver (trusted input),
  unified driver seam. Background-only.
- `providers/` — OpenAI/Anthropic adapters, presets, storage, config UI (add/edit dialog,
  list, per-task header picker, first-run onboarding). Adding a provider is a data change in
  `presets.ts` — never a code change elsewhere.
- `conversation/` — history, message types, chat UI (MessageList, ChatInput, RunStatus).
- `shared/` — Port protocol, shared types, brand mark (`logo.ts`).
- `src/components/` — cross-domain Base UI primitives: Button, Select, TextField, PasswordField,
  TextArea, ConfirmDialog.
- `src/lib/` — storage helpers, logger, Tailwind theme tokens (`brand-*` purple scale).

### Data flow

| Channel                         | What                                         | Why                                                |
| ------------------------------- | -------------------------------------------- | -------------------------------------------------- |
| `wxt/utils/storage` + `watch()` | Settings, provider configs, history          | Cross-context pub/sub, zero messaging code         |
| Port (`runtime.connect`)        | Token deltas, step events, run/stop commands | Streaming; an open Port keeps the MV3 worker alive |

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
- **Stream retry** happens in place (agent loop) with full-jitter backoff, only while nothing
  has been emitted yet — the UI never sees replayed tokens.
- **Stop is not an error.** User abort is normal control flow: the loop ends with `done`, never
  a red bubble. The `done` event carries the model's final summary — on tool-only final turns it
  IS the answer, so the panel renders it when no text was streamed.
- **Model lists are live, presets are fallback.** `listModels` (`models.ts`) reads
  `GET {base}/v1/models` (Anthropic-shape) or `GET {base}/models` (OpenAI-shape, non-chat ids
  filtered). `ProviderConfig.model` is optional — absent means auto, resolved at run start by
  `resolveProviderModel`: persisted choice → newest listed (by `created`) → preset's first →
  clear error. QwenCloud has no list route; that's why presets keep model ids at all. Model and
  effort are per-task choices in the side-panel popover, persisted per provider — never asked
  for at provider-setup time (the key doesn't exist yet, so the list can't be fetched there).

## Reference material

`refs/` is **gitignored** — proprietary code (Claude extension, Kimi WebBridge) kept locally as
read-only reference; nanobrowser (Apache-2.0) also lives there. Patterns may be studied; never
copy a line from the proprietary ones.

## Conventions

- TypeScript strict, `noUncheckedIndexedAccess`, `verbatimModuleSyntax` — `import type` for
  type-only imports (ESLint-enforced).
- No `any` in production code (ESLint-enforced). Fix the underlying type mismatch instead.
- No deprecated aliases or compatibility shims — clean breaks, fix the real problem.
- Prettier: 2-space, double quotes, semicolons, width 100.
- `@/*` alias → `src/*` (via `srcDir: "src"` in wxt.config.ts — WXT owns the `@` default).
- Base UI for interactive primitives — go through `src/components/`, don't hand-roll buttons,
  selects, inputs, or dialogs.
- Theming: class-strategy dark mode (`@custom-variant dark` in `src/lib/theme.css`) — every color
  utility needs a `dark:` counterpart. The preference lives in `src/lib/theme.ts` (`themeMode`
  item, default `"system"`; `initTheme()` runs once per entrypoint, before render).
- Every error and empty state must orient and offer a way forward — Problem · Cause · Fix for
  errors; Purpose · Content · Action for empty states. Never a raw error or a bare "no results".
- Non-trivial logic leaves one runnable check behind (a small vitest file — no frameworks, no
  fixtures).
- Brand assets are generated: edit `src/shared/logo.ts`, run `bun run icons`. Never hand-edit
  `public/icon/*`.
