# Regent

Provider-agnostic browser agent extension — lets an LLM drive your real browser
with existing logged-in sessions. Chromium-only (chrome.debugger).

## Commands

```bash
bun run dev       # dev mode with hot reload
bun run build     # production build → .output/chrome-mv3
bun run test      # vitest
bun run lint      # eslint
bun run format    # prettier
bun run compile   # tsc --noEmit
```

Load: `chrome://extensions` → Developer mode → Load unpacked → `.output/chrome-mv3`.

## Architecture

Domain-first `src/modules/<domain>/` mirroring featury's server modules. Each
module has an `index.ts` barrel and colocated `__tests__/`.

**Runtime boundary:** files outside a `ui/` folder cannot import `react`,
`react-dom`, or `zustand` — enforced by ESLint `no-restricted-imports`. This
keeps the service worker React-free.

### Modules

- `agent/` — agent loop, tools, system prompt (background-only)
- `browser/` — snapshot, CDP driver (background-only)
- `providers/` — OpenAI/Anthropic adapters, presets, storage, config UI
- `conversation/` — history, message types, chat UI
- `settings/` — settings storage, settings UI

### Data flow

| Channel | What | Why |
|---------|------|-----|
| `@wxt-dev/storage` + watch() | Settings, provider configs, conversation history | Cross-context pub/sub, zero messaging code |
| Port (`runtime.connect`) | Token deltas, step events, commands | Streaming; open Port keeps MV3 worker alive |

## Reference material

`refs/` is **gitignored** — proprietary code (Claude extension, Kimi WebBridge)
kept locally as read-only reference only. nanobrowser (Apache-2.0) also lives
there. Never copy from Claude or Kimi; clean-room implementations only.

## Conventions

- TypeScript strict, `noUncheckedIndexedAccess`, `verbatimModuleSyntax`
- `import type` for type-only imports (enforced by ESLint)
- No `any` in production code (enforced by ESLint)
- Prettier: 2-space, double quotes, semicolons, width 100
- `@/*` alias → `src/*`
