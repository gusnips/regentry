# Architecture deep-dive

Load-bearing details behind the AGENTS.md module map. Read this when a task touches a
module's internals, not on every session.

## Modules

### `agent/` — the run engine

Agent loop (stream → tool calls → results → repeat), tools, system prompt, run slot +
serial queue, run start.

A panel run **works the tab the user is looking at by default** (`resolveRunTab`):
the state the task is about — the half-filled form, the search results, the scrolled
thread — lives in that tab and nowhere else, and re-visiting its url in a fresh tab
would both lose it and open a second live session the site may read as a bot. So the
default run adopts the current tab: groups it under the task's name, drives it with
`activateOnSwitch` on, and settles the group with ✓/?/✗ when it lets go. The composer
toggle's `thisPage` is the same drive minus the group bookkeeping.

Adoption is safe because of the plan gate, not instead of it: the run reads the page and
proposes a plan before any action tool unlocks, so "don't touch this draft" is a plan
rejection, not a reason to have forked the tab. Only a tab the run *opened* is taken
back on a rejected plan — an adopted tab is the user's own and is never closed.

The run still gets a tab of its own when there is no page to work: a blank/new-tab page,
a restricted page (chrome://, the Web Store — those error out of `resolveRunTab` before a
run exists, so the model never has to be told about a page it never saw), an MCP client
(no current tab at all — its sessions start on the neutral default), or a run the client
pointed at an explicit URL. Those forks open on `defaultStartUrl` (then google), inactive,
labelled with the task, and — for the panel only — brought forward once they're loaded and
grouped, so a run that fails to start takes its tab back without the user ever seeing it
blink past.

An unanswered question is the one case the run goes back to a tab it had before: it
returns to the **very tab** the question was asked on when that tab is still alive and
still there, page state and all — re-opening its url would lose the half-filled form or
search results the question was about. The task message tells the model whose tab it's
on (`mode.adopted`, `mode.background`), so it reads-and-plans on the user's tab and stays
put in its own.

`run-queue.ts` is the FIFO on top of the single
slot: every submission goes through `submitRun` — free slot starts now, occupied waits and
`releaseRun`'s listener pumps — and mirrors every transition to the `runBoardItem` storage
record, the ambient "what is TabRunner doing" that the status widget, the panel's
RunBoard, and the MCP `get_status` queue all read. **Runs survive the panel closing** —
port disconnect never aborts; persistence therefore lives in the worker (one
`TranscriptWriter` per run, same as the bridge always did), and a keepalive alarm holds
the worker through long provider silences while no panel pings. Done/error/question fire
OS notifications when no panel is connected.

The system prompt carries a consequential-action policy (paying, sending on the user's
behalf, deleting, submitting need explicit permission), enforced through the `ask_user`
tool: the run ends on a question the panel renders as a card, and the answer arrives as
the next message. `choices` are optional and mean something — a few concrete options get
tappable chips, an open answer (a name, free text) gets none and the composer IS the
answer field, which the card says outright. **A question in plain prose does not pause
the run** — the model streams it, the loop sees no tool call, and the user is left
answering into a run that already moved on; the prompt forbids it and the tool-less-turn
nudge steers a just-asked question back into `ask_user`. The panel gates the card's
chips/hint and the composer's placeholder on ONE shared rule (`ui/ask-gate.ts`): the
newest question with no user reply after it. Not "the last message" — the sentence a
model streams alongside its `ask_user` call lands after the card and would otherwise
hide the answer affordance on the one question that needs it. The choices travel to
every surface that relays the question, the MCP bridge included — a client that sees
only the text invents its own wording for options the run is waiting on verbatim.

**The plan is also a gate, not just a checklist.** Action tools (navigate, click, type,
press_key, scroll) are rejected by the loop until the user approves a plan (`ACTION_TOOLS`
in `agent/loop.ts` — reads and bookkeeping stay free so the model can look before it
plans). `switch_tab` is deliberately outside the gate: it changes nothing on any page and
it is how the agent reaches the page it must read first, which for a run starting
on the tab it's driving is the normal opening move. A turn's calls run with `plan`
hoisted first (`planFirst`) — models routinely batch the plan with the step it opens with,
and in wire order that step would bounce off the gate its own approval was about to open.
A bounced call gets a step row with a `detail`, so the red ✗ opens like every other row
instead of dead-ending on "Blocked".

The first `plan` call of a run parks the loop on `onPlanApproval`; the panel renders the
parked proposal as an approve/adjust/reject card (`plan_approval` event + command in
`shared/protocol.ts`, resolver parked on the `ActiveRun` slot), and a stop answers "no"
via the abort listener so the loop never hangs. The parked steps are kept on the slot
beside the resolver: the card lives only in panel memory, so a panel that closed and came
back (exactly what clicking the away notification does) re-arms it from the worker's
`query_run` answer — otherwise the notification led to a question with no way to say yes.
Mid-run replans
re-ask only when the UPCOMING steps deviate from what was approved (`planNeedsReapproval`
— plain string equality, so a reworded step re-asks too; for a safety gate, over-asking
beats under-asking). A bare rejection ends the run with `errors.planRejected` as the done
summary; a rejection WITH feedback is a revision request instead — the note rides back
inside the plan tool's own result (a separate user message would collide with the
tool_results turn, which Anthropic forbids), the gate re-arms, and the revised plan is
asked about again. A parked approval fires the same away-only OS notification as ask_user
(`tabrunner-plan`), since the user has usually tabbed away by the time a replan asks
again. **Parked speaks "waiting", never "working"**: while the loop sits on an answer the
driven tab's pulsing favicon and badge settle into the still "?" (`waitAgentIndicator` —
the same language an ask_user wait shows), the run board's entry carries `awaiting`
(`markRunningAwaiting`) so the widget pill and the panel's RunBoard swap their pulse for
the same mark, and the panel's status band drops its shimmering verb for a static
"waiting" line — motion is the "the agent is clicking" signal and a parked run is blocked
on the human, not clicking. An approve or revise re-raises the working marks; a reject's
unwind clears them. Bridge runs auto-approve — the MCP client is an AI carrying its own
consequential-action policy, with no human at its end of the wire to click approve; the
plan still crosses its event stream.

### `browser/` — page control and visibility

Accessibility-tree snapshot (injected script), CDP driver (trusted input), unified driver
seam, on-page "TabRunner is controlling this tab" badge plus an amber dot over the driven
tab's favicon so the strip shows where a run is working — the dot pulses via frames pushed
from the worker, because Chrome throttles hidden-tab timers and hidden is exactly when the
strip signal matters; a run blocked on the user (ask_user, plan approval) settles the
pulse into a still "?" and drops the badge — waiting-on-you, not working
(`waitAgentIndicator`). Also `restricted-url.ts` (`isRestrictedUrl`, the proactive form of
the injection rejection) and `status-widget.ts`: the floating pill ("TabRunner ·" + task +
queue count, an open-panel button messaging the worker, and a hide button that collapses
the pill in-page to a small blinking status dot — the dot keeps the working/waiting mark
and a click on it brings the pill back), injected only into each
window's active tab while the run board is non-empty — never the driven tab, which has the
badge — moved on activation/focus churn, removed everywhere when idle or hidden via the
`widgetHidden` pref.

**Three ambient signals, and only one of them is guaranteed.** The indicator and the pill
are both `chrome.scripting.executeScript`, which a restricted page, a PDF viewer, a
`file://` url without file access, or a hostile CSP can refuse — silently, because a run
must never fail because its marks could not be drawn. The pill has two more holes:
`widgetHidden` turns it off for good, and it skips the driven tab, which under tab adoption
IS the tab the user is looking at. So the injected layer can be entirely absent, and closing
the panel would leave nothing on screen. `action-badge.ts` is the floor beneath it: a
toolbar count (or "?" when parked on the user) painted by the browser itself, on every page
type, whatever the pref says — cleared at worker boot, since badges outlive the worker that
set them. The run's green tab group is injection-free for the same reason. A refused paint
is therefore a degradation, never a dead end; `showAgentIndicator` treats it as one and
skips the favicon heartbeat rather than firing a doomed `executeScript` every 700ms forever.

### `providers/` — config and sign-in

OpenAI/Anthropic/Responses adapters, presets, storage, config UI (add/edit dialog, list,
per-task header picker, first-run onboarding). Adding a provider is a data change in
`presets.ts` — never a code change elsewhere. (A new WIRE SHAPE is the exception: adapter

- factory case + `ProviderShape` union.) Preset ORDER is the picker's order and its first
  entry is the add form's default, so the subscription rows lead: a plan the user already
  pays for beats sending them to a billing console before their first task.

Sign-in is shared too: `oauth.ts` owns PKCE, the redirect capture, and the token POST; the
per-vendor files own only client ids, authorize params, and which claim names the account;
`oauth-flows.ts` is the ONE registry (`signIn` + `refresh` per preset id) that both the
sign-in card and the credential seam read, so a provider can't be half-wired;
`ui/OAuthSignIn` is the one card for all of them, its copy parameterized on the display
name and the vendor's host. **A token in the body — not a 2xx — is what makes a sign-in
successful**: vendors answer 429 with a usable credential (a plan over its usage limit),
and discarding it would force a pointless re-login. A pasted key is verified before it's
stored (`isKeyRejected`, one model listing); only a flat rejection blocks the save, since
a 404 (no list route) or an offline endpoint proves nothing about the key.
Credential-shaped copy is credential-aware end to end — a signed-in provider never gets
told to fix an API key it doesn't have (`errors.kindAuthSignedIn`,
`chat.hint.signedOut`).

**A subscription token dies at Anthropic's CORS gate unless the request carries no
`Origin`** — a service worker is a document context, so Chrome stamps
`chrome-extension://<id>` on every fetch and the org gate 401s it. `providers/origin.ts`
strips `Origin`/`Referer` from our own calls to the preset hosts via a
declarativeNetRequest session rule; a user-typed custom endpoint keeps its Origin. This is
the sanctioned shape, not a hack: the official Claude for Chrome extension declares the
same `declarativeNetRequestWithHostAccess` permission and ships no static rule resources,
so it too does its header surgery with runtime rules. (`chrome.identity` is closed to us
for a different reason: it forces a `chromiumapp.org` redirect, and the CLI client ids we
reuse only accept `http://localhost:<port>/callback`.)

### `conversation/` — chat and persistence

Stored conversations, message types, chat UI (MessageList, ChatInput, RunStatus, RunBoard,
ConversationList). `transcript.ts` is the persistence half of the event stream,
background-safe: one `TranscriptWriter` per run turns run events into stored messages. The
worker owns it for every run (panel runs included — the panel closes itself after submit,
so a panel-side writer would die with it); the panel store only renders. Two views of one
event stream, and they must stay in lockstep.

### `tips/` — rotating tips

The rotating "Tip: …" line (Claude Code's spinner-tip pattern, reduced): a dim hint under
the running run band and in the composer footer's right slot (the paste hint outranks it
there). Tips are i18n data (`tips.*` keys, object-map variant of the `run.idle` array
pattern); `registry.ts` owns ids and per-tip cooldowns in panel opens; `scheduler.ts`
picks least-recently-shown among the cooled-down (never-shown is always eligible) and
persists `tipStats`. Re-picked only at boundaries — panel open and each run end, from the
sidepanel App — never on a timer. One module-level current tip, so both slots agree;
`tipsEnabled` pref opts out.

## Data flow

**Conversation storage** (`conversation/conversations.ts`): a `conversations` index of
metadata (id, title, counts, driven tabs) plus one `conversation:<id>` key per transcript
— appending rewrites a single transcript, never the whole store. The panel writes through
`appendMessage`, which resolves the active id itself, so the background worker can append
(e.g. a cancelled queued run's breadcrumb) without knowing which conversation is open.
Every write is read-modify-write and the panel fires them from an event stream, so
`appendMessage`/`replaceMessage` are **serialized** on one promise chain — concurrent
appends otherwise read the same array and the last write wins. `sendTask` **awaits** its
user message before posting `run`: the worker builds the run's history by reading the
transcript, and a fire-and-forget write loses that race every time. A fresh conversation
is created lazily by its first message, so "New chat" never leaves an empty row behind.

The transcript doubles as the model's memory, strictly per conversation: at run start the
background rebuilds _that_ conversation's transcript as alternating user/assistant wire
turns (`buildConversationHistory` in `agent/history.ts`) — entries capped, a total char
budget spent newest-first, the original task always kept — and replays it ahead of the new
task message, so "continue" lands on a model that has read the same exchange. A new chat
starts clean; the only context that crosses chats is AGENTS.md / MEMORY.md. Steps and
reasoning stay out of it; outcomes live in the assistant's own words, ask_user questions
included. Conversations remain scrollback you can revisit and delete.

A run that ends before writing any closing summary used to fall through that design —
no assistant words, so the work vanished from the replay and "continue" started blind.
The writer closes the hole itself: on an `error` event, and on the summary-less `done`
a user stop unwinds into, it appends a deterministic progress note
(`conversation/progress-note.ts`) built from the run's persisted step rows —
deliberately NOT a model call, since the failures that reach there (a 429, a dead tab)
are exactly the ones where asking the model to summarize would fail too. The two
endings close differently: a failure tells the next run to resume, a stop hands the
next move to the user and merely offers the history — stopping often means "do
something else", and the work should be available, not mandatory. (A run that ends on
`ask_user` writes no note; its question is its closing word. The note also consumes the
steps it reports, so a closed tab — error, then abort — leaves one note, not two.) The
note is an ordinary assistant message, so it replays like any other. When the model
needs more than its outline, the `read_history` tool pages the stored transcript
(user/assistant/error turns, plans, step rows with optional result extracts) by absolute
index — append-stable while the current run keeps writing — newest window by default,
char-capped with `to` marking where to continue.

**Tabs belong to messages, not to the conversation.** One run per message, and the user
moves between messages: in "this page" mode each user message is stamped with the tab it
was sent from (shown in the transcript once the conversation spans more than one tab —
background runs adopt that same tab, so the stamp names the tab the run is about either way), and the conversation
keeps the tabs its runs drove — deduped by url, newest first, capped. A "this page" run
starts on the submit-time active tab; the task message names any stored tabs the user is
not on, so "that email" and "the doc" can find their way back via list_tabs/switch_tab.
The stored tab keeps its `tabId` and the `groupId` of the group that run created — the
first so a continuation can return to the live tab, the second so it retitles only a group
it owns and never a group the user filed the tab into.
