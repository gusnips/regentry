# MCP bridge

Regentry's side panel is one way to give it a task. The MCP bridge is another: it lets an external
AI client — Claude Code, Claude Desktop, ChatGPT desktop, anything speaking the
[Model Context Protocol](https://modelcontextprotocol.io) — drive **the same agent, in the same
browser, with the same logins**.

The client doesn't get a pile of low-level browser tools. It gets one instruction: _do this in the
browser_. Regentry plans, clicks, reads, and reports back — with its own model, its own memory,
and its own permission rules.

## How it fits together

```
Claude Code / Claude Desktop / any MCP client
        │  MCP over stdio
        ▼
daemon/  (bun; @modelcontextprotocol/sdk)
        │  WebSocket  ws://127.0.0.1:17836/ws
        ▼
Regentry extension  (background service worker)
        │
        ▼
the agent loop → your real Chrome tabs
```

The direction of that WebSocket is forced, not chosen: **an MV3 service worker cannot listen on a
socket**, so the extension can never be an MCP server itself. It dials out to a local daemon, and
the daemon is what your AI client talks to.

## Setup

**1. Install the extension** and open its side panel once. That starts the service worker, which
connects to the bridge. Add a provider first if you haven't — the bridge uses whatever provider and
model the panel is set to.

**2. Register the server** with your client:

```bash
claude mcp add regentry -- bun /path/to/regentry/daemon/src/index.ts
```

Inside this repo, `.mcp.json` already does it — Claude Code picks it up automatically.

**3. Check the link** by calling `health`. It reports whether the extension is connected, and tells
you exactly what to do if it isn't.

The daemon starts when your client starts it; there's nothing to leave running. To run it by hand
(to watch its log, say): `bun run bridge`.

### Configuration

| Variable                                | Default                            | What it does                                                                                     |
| --------------------------------------- | ---------------------------------- | ------------------------------------------------------------------------------------------------ |
| `REGENTRY_BRIDGE_PORT`                  | `17836`                            | The localhost port. Change it in both places — the extension's `bridge` storage item must match. |
| `REGENTRY_BRIDGE_EXPECTED_EXTENSION_ID` | `jlngbadknjppfbohhifabijkimigdiia` | The extension `health` expects. An unpacked dev build has its own id; set this to it.            |

## The tools

| Tool                              | What it does                                                                                                                                         |
| --------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `health`                          | Is Regentry reachable? Reports the connection, the extension id and version, and the fix when something's off. Call it first.                        |
| `run(task, images?)`              | Give Regentry a task in plain language. Returns immediately with a run id — browser work takes minutes. Optional images ride along as base64.        |
| `get_status(wait?, waitSeconds?)` | Where the run stands. **Blocks until something changes** by default, so following a ten-minute task costs one call per real event, not one per poll. |
| `answer(text)`                    | Reply to a question the run stopped on.                                                                                                              |
| `steer(text)`                     | Drop a note into a running task — a correction or an extra constraint. It lands between tool calls; the run doesn't restart.                         |
| `stop()`                          | End the run. Stopping is normal control flow, not an error.                                                                                          |
| `screenshot()`                    | A picture of what the browser is showing right now, as an image the model can actually look at. Works run or no run.                                 |
| `new_conversation()`              | Forget the thread and start clean.                                                                                                                   |

### The shape of a session

```
run("find the Q3 invoice in my email and download it")
  → get_status()        blocks… returns: plan drawn, 2 steps done
  → get_status()        blocks… returns: state: question
                        "Download invoice-q3.pdf to your Downloads folder?"
  → (relay to the user, get their decision)
  → answer("yes")
  → get_status()        blocks… returns: state: done + the answer
```

`get_status` is the wait primitive. Call it in a loop until the state is `done`, `error`, or
`question` — each call returns as soon as something real happens.

### Questions are the user's to answer

Regentry stops and asks before consequential actions — paying, sending on someone's behalf,
deleting, submitting. When `get_status` comes back with `state: question`, that question is for the
**user**, not for the model driving the bridge. Relay it, get a real answer, then call `answer`.

## The conversation model

The bridge keeps **one conversation of its own**, separate from whatever is open in the side panel.
Each run continues the previous ones, so Regentry remembers the pages it visited and what it found
there — ask a follow-up and it knows what "that invoice" means. `new_conversation` starts over.

The thread shows up in the panel's history like any other, so you can read exactly what the agent
did on your behalf.

**One run at a time.** The panel and the bridge share a single run slot, because they share a
single browser. Whoever asks second gets an error naming where the run already is and how to stop
it.

## When things go wrong

Every failure comes back as text that says what happened, why, and what to do next.

| Situation                          | What you get                                                                                                                                    |
| ---------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| Extension not connected            | How to install it and wake the worker. It reconnects on its own within ~30s.                                                                    |
| A different extension connected    | The id that connected, and the env var to accept it (a dev build has its own id).                                                               |
| No provider configured             | Add one in Regentry's settings and pick it in the panel header.                                                                                 |
| No tab to drive                    | Open a tab in the window you want Regentry to work in.                                                                                          |
| A run is already going             | Where it's running — panel or MCP — and how to stop it.                                                                                         |
| The link drops mid-run             | **The run keeps going.** The extension reconnects and re-syncs; `get_status` picks up where it left off. A long task survives a daemon restart. |
| Chrome suspends the worker mid-run | Reported as an interrupted run, not left polling a ghost. Keeping the panel open prevents it.                                                   |
| Another daemon owns the port       | Which port, and how to give this one its own. Every MCP client spawns its own daemon, so this is normal with two clients open.                  |

## Security

The WebSocket binds to `127.0.0.1` — nothing off your machine can reach it. Within your machine,
**anything that can open that port can drive your browser with your logged-in sessions**. That is
the same trust model as any local automation daemon, and it is the reason the bridge is localhost-only
and the port is not exposed.

The daemon is a pipe: it relays tasks and run events. No page content, credentials, or API keys are
stored in it, and it never talks to anything but the extension and your MCP client.

## Developing on it

```bash
bun run bridge        # run the daemon by hand, with its log on stderr
bun run bridge:check  # end-to-end check: spawns the daemon, plays the extension, drives MCP
```

`bridge:check` is the fastest way to know the wiring is intact — it exercises the hello/sync
handshake, request correlation, the long-poll, and the ask_user round trip without needing Chrome.

The wire protocol is declared twice on purpose: `src/modules/bridge/protocol.ts` (the extension's
copy, and the source of truth) and `daemon/src/protocol.ts`. The daemon is a standalone bun package
and must not import from the extension bundle — change them together.
