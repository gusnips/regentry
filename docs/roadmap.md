# Roadmap

Planned features, with the design settled enough to implement from. Each entry records the
decisions and the concrete hook points so "later" doesn't mean "re-derive everything."

## Scheduled tasks

**"At 3pm, open site X and do Y"** — one-shot and recurring runs on a timer, executed as
background runs, plus a `schedule_task` agent tool so the agent itself can schedule future work.

### Permissions

None new. Everything the feature needs is already declared in `wxt.config.ts`:

- `alarms` — the scheduling primitive. `chrome.alarms` wakes the suspended MV3 worker at fire
  time (today it only serves the bridge reconcile alarm; a scheduler reuses the same grant).
- `storage` — persist the schedule index (worker dies between alarm fires; see below).
- `tabs` / `tabGroups` — the background run's fresh inactive tab and its labelled group.
- `notifications` — completion/failure/needs-you alerts when nobody is watching.

The only hard external requirement: the browser must be running. Chrome persists alarms across
restarts, so an alarm that matures while the browser is closed fires at next launch.

### Architecture

Run start is already worker-native — `startAgentRun()` (`src/modules/agent/start-run.ts`) needs
no panel; both existing callers (panel port, MCP bridge) invoke it from the service worker and
the panel only consumes `emit()` events. A scheduler is a **third caller**, not a new run path:

- New `src/modules/schedule/` module (background-only): storage schema, alarm
  registration/reconcile, and the launch closure.
- A `schedules` index in wxt storage: `{ id, task, url?, fireAt, repeat?, createdBy }`, one
  `chrome.alarms.create("schedule:<id>", …)` per entry. One-shot `when` for "at 3pm";
  `periodInMinutes` for recurring (alarm resolution is ~0.5–1 min — fine for chores, not for
  cron-precise timing).
- On `alarms.onAlarm`, call `submitRun()` (`src/modules/agent/run-queue.ts`) with a launch
  closure identical to the panel's: `new TranscriptWriter(conversationId)` + `startAgentRun`.
  Scheduled runs get their own conversation(s) so they don't clobber the user's active thread.
- Startup reconcile mirrors the stale-board recovery at `background.ts` (reset orphaned state,
  re-arm alarms from storage). The keepalive-alarm pattern (`background.ts`, 0.5-min alarm while
  the run board is non-empty) is the template for holding the worker through a long run.
- Surfacing already exists: `notifyRunEnded()` (`background.ts`) fires an OS notification when
  the panel is closed, and clicking it opens the panel at the right conversation.

### The plan gate — decided

Action tools park on `plan` approval; for `owner: "panel"` the approval promise only resolves
from the panel. A scheduled run launched that way with nobody present **parks forever on the
first plan**. Decisions:

- **Creating the schedule IS the consent.** The user confirms the task (and URL, time,
  recurrence) at schedule-creation time; the run then executes with that pre-approved scope.
  Add a third `RunOwner` (`"schedule"` alongside `"panel" | "bridge"` in
  `src/modules/agent/active-runs.ts`) that gets bridge-style plan auto-approve without
  inheriting panel routing. A scheduled run must never silently expand beyond the approved task
  — the pre-approval is scoped to what the user confirmed.
- **`ask_user` needs no gate work** — it is run-_terminating_, not pausing: the loop ends the run
  `done` with the question attached. For scheduled runs that means: run ends, OS notification
  tells the user their input is needed, the answer arrives later as a normal reply that starts a
  follow-up run with history replayed. Notifications are the alerting channel for anything that
  would otherwise wait on the panel.
- **Always pass an explicit `url`.** With `owner: "panel"` and no `url`, `resolveStartUrl()`
  snapshots _whatever tab the user currently has focused_ as the start page. Scheduled runs pass
  `url: X` for "open site X", or the neutral default start URL — never the user's focused tab.

### Missed fires — decided

Browser closed at fire time → the alarm fires at next launch. Policy: **run late**, with a note
in the transcript that the run was scheduled for an earlier time. (Skip-if-stale was considered
for time-sensitive tasks; if that need shows up, it becomes a per-schedule flag, not the
default.)

### The agent tool

`schedule_task` (task text, optional URL, fire time, optional recurrence) is a thin writer of
schedule records — registered in the agent tools switch and gated through the plan like other
action tools, so the user approves the schedule itself before the agent can create it (this
dovetails with "creation is the consent"). If it's also exposed over MCP, remember the protocol
is declared twice on purpose: `src/modules/bridge/protocol.ts` (source of truth) and
`daemon/src/protocol.ts` — change both, then `bun run bridge:check`.

### Ship checklist (when built)

- [ ] `src/modules/schedule/` module: storage schema, alarm register/reconcile, launch closure
- [ ] Third `RunOwner` `"schedule"` with bridge-style auto-approve
- [ ] `schedule_task` agent tool (+ MCP protocol pair, if exposed there)
- [ ] A panel surface to see/cancel pending schedules (never dead-end the user)
- [ ] i18n keys in all three catalogs (`en`, `pt-BR`, `es`) + `bun run i18n:check`
- [ ] A tip in `src/modules/tips/` (registry id + cooldown + copy in all three catalogs)
- [ ] Vitest file for the reconcile/missed-fire logic
- [ ] Gates: `compile`, `lint`, `test`, `deadcode`, `i18n:check`
