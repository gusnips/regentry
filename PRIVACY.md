# Regentry Privacy Policy

_Last updated: 2026-08-08 · Applies to Regentry for Chromium browsers (Chrome, Brave, Edge, Arc,
Opera, Vivaldi), version 0.1.0._

**The short version:** Regentry is a browser agent you run. There is no Regentry server, no
account, no telemetry, and no analytics. Everything you type or configure stays on your device, in
your browser's local storage. The only places your data ever goes are (1) the AI provider **you**
configured and (2) the websites you ask Regentry to act on.

---

## 1. What Regentry collects

**Nothing from us.** Regentry has no backend, no account system, and no telemetry. It does not
contact the developers, a license server, or any analytics service at any time, including when it
runs. The extension works entirely between your browser, your configured provider, and the sites
you point it at.

**What you put in.** Regentry stores, in your browser's local storage (`chrome.storage.local`,
namespaced `local:regentry:*`):

- **Provider configuration** — the providers you add (name, base URL, API shape, optional model
  preference) and the **API key** you paste in. Keys are stored locally so you only enter them
  once.
- **Conversation history** — the transcripts of your tasks, including the task text you typed, the
  provider's replies, and a record of the actions Regentry took. The 50 most recent conversations
  are kept.
- **Memory documents** — the optional `AGENTS.md` (your standing instructions) and `MEMORY.md`
  (what Regentry has learned) files shown in the Settings → Memory panel.
- **Preferences** — theme and language choices.

## 2. What Regentry processes, and where it goes

When a task runs, Regentry reads the page you're working on and turns it into a **compact
accessibility-tree snapshot** (`[ref=e12] button "Submit"`) — not raw HTML, not the page's scripts
or media. That snapshot, your task text, the conversation so far, and (when it captures one) a
screenshot of the page are sent **to the provider you configured**, using your own API key, over
HTTPS. The provider's replies and its tool calls come back to the extension, which executes them
in your browser as real user input.

**Regentry never uploads your data anywhere else.** The complete list of network recipients is:

1. **Your configured provider** — the model provider (or custom endpoint) you chose. It receives
   the task, the page snapshots, screenshots, and your API key for authentication. Your key is
   transmitted only to that provider, over TLS, as part of the provider's own API.
2. **The websites you ask it to drive** — navigating, clicking, and typing on a site sends the same
   traffic your own browser session would, with your existing logins. Regentry does not re-route,
   log, or capture this beyond what the site itself sees.

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
- **Stop anytime** — closing the panel or pressing Esc stops the run. Nothing is sent after it
  stops.
- **Uninstall** — removing the extension from `chrome://extensions` deletes all of its local
  storage.

## 5. Permissions, explained

| Permission | What it's for |
| --- | --- |
| `debugger` | Real trusted input — clicks and keystrokes are dispatched over the Chrome DevTools Protocol so sites can't ignore them. |
| `scripting` | Injects the accessibility-tree snapshot script into the tab Regentry reads. |
| `sidePanel` | Hosts the chat UI where you write tasks and watch the run. |
| `tabs` | Reads the active tab's URL/title and switches tabs when a task references another open tab. |
| `activeTab` | Grants access to the tab you submit a task from, per action. |
| `storage` | Persists provider configs, history, and memory locally. |
| `notifications` | Alerts you when Regentry needs your input while Chrome isn't focused. |
| Host permissions (`<all_urls>`) | Regentry must be able to navigate, read, and interact with any site you ask it to use. It uses this only when a task is running. |

## 6. Guardrails

- **Ask before acting.** Consequential actions — paying, sending, deleting — require your explicit
  confirmation in the panel before they execute.
- **No background surveillance.** Regentry reads and acts on pages only while a task you started is
  running, and only on the tabs that task touches.

## 7. Changes to this policy

If Regentry's data handling changes in a way that affects this policy, this document is updated and
the version bump is noted in the changelog of the release. Material changes will be called out in
the extension's release notes.

## 8. Contact

This project is maintained on GitHub at [gusnips/regentry](https://github.com/gusnips/regentry).
Questions about this policy: open an issue
([github.com/gusnips/regentry/issues](https://github.com/gusnips/regentry/issues)).
