# TabRunner Privacy Policy

_Last updated: 2026-08-08 · Applies to TabRunner for Chromium browsers (Chrome, Brave, Edge, Arc,
Opera, Vivaldi), version 0.1.0._

**The short version:** TabRunner is a browser agent you run. There is no TabRunner server, no
account, no telemetry, and no analytics. Everything you type or configure stays on your device, in
your browser's local storage. The only places your data ever goes are (1) the AI provider **you**
configured and (2) the websites you ask TabRunner to act on.

---

## 1. What TabRunner collects

**Nothing from us.** TabRunner has no backend, no account system, and no telemetry. It does not
contact the developers, a license server, or any analytics service at any time, including when it
runs. The extension works entirely between your browser, your configured provider, and the sites
you point it at.

**What you put in.** TabRunner stores, in your browser's local storage (`chrome.storage.local`,
namespaced `local:tabrunner:*`):

- **Provider configuration** — the providers you add (name, base URL, API shape, optional model
  preference) and the **API key** you paste in. Keys are stored locally so you only enter them
  once.
- **Conversation history** — the transcripts of your tasks, including the task text you typed, the
  provider's replies, and a record of the actions TabRunner took. The 50 most recent conversations
  are kept.
- **Memory documents** — the optional `AGENTS.md` (your standing instructions) and `MEMORY.md`
  (what TabRunner has learned) files shown in the Settings → Memory panel.
- **Preferences** — theme and language choices.

## 2. What TabRunner processes, and where it goes

When a task runs, TabRunner reads the page you're working on and turns it into a **compact
accessibility-tree snapshot** (`[ref=e12] button "Submit"`) — not raw HTML, not the page's scripts
or media. That snapshot, your task text, the conversation so far, and (when it captures one) a
screenshot of the page are sent **to the provider you configured**, using your own API key, over
HTTPS. The provider's replies and its tool calls come back to the extension, which executes them
in your browser as real user input.

**TabRunner never uploads your data anywhere else.** The complete list of network recipients is:

1. **Your configured provider** — the model provider (or custom endpoint) you chose. It receives
   the task, the page snapshots, screenshots, and your API key for authentication. Your key is
   transmitted only to that provider, over TLS, as part of the provider's own API.
2. **The websites you ask it to drive** — navigating, clicking, and typing on a site sends the same
   traffic your own browser session would, with your existing logins. TabRunner does not re-route,
   log, or capture this beyond what the site itself sees.
3. **A local MCP bridge on your own machine, if you run one** — TabRunner can be driven by an AI
   client you run yourself (Claude Code, Claude Desktop) through a daemon listening on
   `127.0.0.1`. Nothing off your machine can reach it, and the daemon stores nothing: it relays
   tasks in and run progress out. It only exists while you run it, and TabRunner connects to
   nothing when you don't. See [docs/mcp.md](docs/mcp.md).

No other party — no relay, no proxy, no analytics, no developer-owned server — ever receives your
data.

## 3. What stays private

- **Sensitive fields never leave the page.** Password, card-number, and other `password`/sensitive
  inputs are excluded from the accessibility tree, so they are not sent to the model.
- **Screenshots are transient.** A screenshot taken for the model's context is compressed (JPEG
  q80) and is stripped before the conversation is saved to storage. Your own image attachments,
  when the model supports images, are stored as part of that conversation.
- **Local-only storage.** All configuration and history lives in your browser's local storage on
  this device. Uninstalling the extension removes it.

## 4. Your controls

- **Delete a conversation** — History → ⋯ → Delete. Removes that transcript from this device.
- **Clear memory** — Settings → Memory → Clear, per file. Stops those contents being sent with
  future runs.
- **Remove a provider** — Settings → Providers → Remove. Deletes the stored API key; you can add it
  again any time.
- **Stop anytime** — Esc or the Stop button in the panel, the stop in the Run Board's task list,
  or closing the tab a task is driving stops its run. Closing the panel does NOT stop a run:
  tasks run in their own background tab and keep working after the panel closes — that's the
  point of dispatch-and-forget. Nothing is sent after a run stops.
- **Uninstall** — removing the extension from `chrome://extensions` deletes all of its local
  storage.

## 5. Permissions, explained

| Permission                      | What it's for                                                                                                                                                      |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `debugger`                      | Real trusted input — clicks and keystrokes are dispatched over the Chrome DevTools Protocol so sites can't ignore them.                                            |
| `scripting`                     | Injects the accessibility-tree snapshot script into the tab TabRunner reads.                                                                                       |
| `sidePanel`                     | Hosts the chat UI where you write tasks and watch the run.                                                                                                         |
| `tabs`                          | Opens each task's background tab, reads URL/title, and switches tabs when a task references another open tab.                                                      |
| `activeTab`                     | Grants access to the tab you submit a task from, per action.                                                                                                       |
| `tabGroups`                     | Groups each background task's tab and labels the group with the task (✓/✗/? when it finishes, then collapses it).                                                  |
| `storage`                       | Persists provider configs, history, and memory locally.                                                                                                            |
| `notifications`                 | Tells you when a background task finishes, errs, or stops to ask you something while the panel is closed.                                                          |
| `alarms`                        | Periodic wake-ups: reconnects the local MCP bridge, and keeps the worker alive through a long task while the panel is closed. It runs no task and touches no page. |
| Host permissions (`<all_urls>`) | TabRunner must be able to navigate, read, and interact with any site you ask it to use. It uses this only when a task is running.                                  |

## 6. Guardrails

- **Ask before acting.** When TabRunner's own model is driving, consequential actions — paying,
  sending, deleting — stop the run and ask for your explicit confirmation before they execute: in
  the panel, or relayed to you by whichever client started the task.
- **Direct control is the exception, and it is visible.** An MCP client you connect can also drive
  the browser step by step, without TabRunner's model in the loop — and therefore without that
  confirmation rule, which lives in TabRunner's own prompt. TabRunner does not let this happen
  quietly: the driven page carries the "being controlled" badge, the tab shows the amber dot, and
  every action is written to a conversation in your history, labelled with the client that did it.
- **No background surveillance.** TabRunner reads and acts on pages only while a task you started is
  running, and only on the tabs that task touches.

## 7. Changes to this policy

If TabRunner's data handling changes in a way that affects this policy, this document is updated and
the version bump is noted in the changelog of the release. Material changes will be called out in
the extension's release notes.

## 8. Contact

This project is maintained on GitHub at [gusnips/tabrunner](https://github.com/gusnips/tabrunner).
Questions about this policy: open an issue
([github.com/gusnips/tabrunner/issues](https://github.com/gusnips/tabrunner/issues)).
