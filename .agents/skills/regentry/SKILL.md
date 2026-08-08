---
name: regentry
description: |
  Regentry drives the user's real Chrome — their tabs, their sessions, their logged-in accounts — to get things done on the web. Use this skill whenever the user wants something done in a browser: booking, buying, filling a form, reading a page behind a login, pulling data off a site, checking email, or any task on a site they're signed into. Also use when the user mentions "browser", "my email", "that page", "log in", "open URL", or "screenshot". Regentry is an agent, not a scraper: give it the goal, not the clicks.
---

# Regentry

Regentry is a browser agent with its own model. You don't drive the browser — **you give Regentry a
task and it drives**. It plans, navigates, reads pages, clicks, types, and reports back.

That distinction shapes everything below. Ask for the outcome ("find the Q3 invoice in my email and
download it"), not the mechanics ("navigate to gmail, click search, type invoice…").

Regentry is provider-agnostic — any MCP agent can drive it the same way. This skill ships in the
cross-tool Agent Skills locations: `.agents/skills/regentry/` is canonical (read by Codex, Gemini
CLI, Cursor, GitHub Copilot and Windsurf), and `.claude/skills/regentry/` is an identical copy for
Claude Code, which only scans `.claude/`. Keep the two in sync. `docs/mcp.md` is the canonical,
human-facing reference.

## Delegate, or drive?

Two ways to use Regentry. Pick deliberately:

**Delegate — `run`. The default.** You state the goal; Regentry's own model plans and executes it.
One MCP turn per real event instead of one per click, and it stops to ask the user before anything
consequential. Right for anything long, open-ended, or on a site you'd have to explore.

**Drive — `browser_start` and the `browser_*` tools.** You read the page, click, and type yourself.
Right when the job is small and exact ("open this URL and read me the price"), when you need one
specific element, or when each step decides the next. Costs one MCP turn per action, so it gets
expensive fast on a real task — and it takes Regentry's own model, and its permission rule, out of
the loop.

When in doubt, `run`. It's the reason this thing exists.

## The tools

| Tool                              | Use it for                                                                                         |
| --------------------------------- | -------------------------------------------------------------------------------------------------- |
| `health`                          | First call, and after any connection error. Says whether the browser is reachable and what to fix. |
| `run(task, images?)`              | Start a task. Returns immediately — browser work takes minutes.                                    |
| `get_status(wait?, waitSeconds?)` | Follow the run. **Blocks until something happens** — this is your wait, not a poll.                |
| `answer(text)`                    | Reply to a question the run stopped on.                                                            |
| `steer(text)`                     | Correct or constrain a task already running, without restarting it.                                |
| `stop()`                          | End the run. Not an error.                                                                         |
| `screenshot()`                    | See the browser yourself. Works whether or not a task is running.                                  |
| `new_conversation()`              | Start a fresh thread when the next task is unrelated to the last.                                  |

Driving yourself:

| Tool                                 | Use it for                                                                                |
| ------------------------------------ | ----------------------------------------------------------------------------------------- |
| `browser_start(goal)`                | Take the wheel. Returns the first snapshot; the goal names what the user sees in history. |
| `browser_snapshot()`                 | Read the page — an accessibility tree with a `ref` on every interactive element.          |
| `browser_navigate(url)`              | Go somewhere.                                                                             |
| `browser_click(ref)`                 | Click by ref, as a real trusted event.                                                    |
| `browser_type(text)`                 | Type into whatever is focused — click the field first.                                    |
| `browser_press_key(key)`             | `Enter`, `Escape`, `Tab`, an arrow.                                                       |
| `browser_scroll(direction, amount?)` | Below the fold isn't in a snapshot until you scroll to it.                                |
| `browser_tabs()` / `browser_switch_tab(id)` | Find another tab and re-target every later action at it. |
| `browser_end()`                      | Hand the browser back. Always call it when you're done.                                   |

**Refs belong to the snapshot that made them.** Every action returns the page it produced — act on
that, never on a ref you read two actions ago.

**Driving means the guardrail is yours.** Regentry stops to ask before paying, sending on the
user's behalf, deleting, or submitting — but that rule lives in _its_ model, which you have just
taken out of the loop. When driving, put those to the user yourself before you click. If you'd
rather not carry that, use `run`.

## The loop

```
run("…")
while state is running:
    get_status()          ← blocks until real progress; never poll in a tight loop
if state is question:     relay it to the user, then answer(their reply)
if state is done:         report the answer
if state is error:        read the error — it says what to do
```

`get_status` returns as soon as the run does something. One call ≈ one real event, so following a
ten-minute task is cheap. Never sleep-and-poll, and never assume silence means finished.

## Rules that matter

**Questions belong to the user.** Regentry stops and asks before consequential actions — paying,
sending a message on the user's behalf, deleting, submitting an application. When `get_status`
returns `state: question`, that question is for the **user**. Relay it, wait for a real answer, then
call `answer`. Never approve a purchase, a send, or a deletion on your own judgement — that is the
one thing this skill must not do.

**Start the daemon yourself; don't send the user to do setup.** If `health` says nothing is
connected, read what it tells you and act on it. Only involve the user for things only they can do —
installing the extension, opening the panel, choosing a provider.

**Say which site.** The run starts on the tab the user is looking at. If the task belongs on a
particular site, put the URL in the task text — Regentry will navigate there.

**One run at a time.** Regentry drives one browser, so the panel and this bridge share a single run
slot. If a run is already going, `run` tells you where it is. `stop()` ends your own; a run the user
started in Regentry's panel is theirs to stop — ask them, or wait.

**Steer instead of restarting.** If the goal is unchanged and you just need to correct course, use
`steer`. It lands between tool calls. Reserve `stop` + `run` for a genuinely different task.

**The thread has a memory.** Runs continue each other — Regentry remembers the pages it visited and
what it found. Follow-ups can say "that invoice". Call `new_conversation` only when the subject
truly changes.

## Reporting back

When a run finishes, `get_status` gives you the answer in Regentry's own words. Relay the substance
— what it found, what it did — not a play-by-play of the steps. If you need to verify a result with
your own eyes, call `screenshot`.

If a run ends in an error, the error text already says what happened and what to try. Pass that on
rather than guessing at causes.

## Setup, if it isn't working

`health` reports the exact problem and its fix. The usual ones:

- **Not connected** — the extension isn't installed, or its service worker is asleep. The user
  installs Regentry in Chrome and opens the side panel once; it reconnects within ~30 seconds.
- **No provider** — the user adds one in Regentry's settings and picks it in the panel header.
  Regentry runs on the user's own model, not yours.
- **A different extension id** — usually an unpacked dev build. `health` names the id to accept.

Full reference: `docs/mcp.md` in the Regentry repo.
