# Roadmap

Not a promise — a record of what we think is next and, more usefully, _why_, so a decision made
once doesn't get re-litigated from scratch six weeks later. Items graduate out of here into
`docs/agent/*.md` (as-built) when they ship.

## The bet

Everything below is judged against one question: **does it compound the thing a sandboxed agent
structurally cannot copy?**

Operator, computer-use-in-a-VM, and the Browserbase-shaped products all drive _a_ browser. They
cannot drive _yours_ — your cookies, your SSO, your 2FA'd bank, your work Google account — because
the whole point of their sandbox is that it isn't your machine. TabRunner's moat is that it runs
inside the browser you're already logged into, and (since v0.4.2) keeps running when you're asleep.

So the ranking rule: **a feature that only makes the agent smarter is worth less than a feature
that makes it smarter _about your sites, over time_.** Generic agent-loop improvements are table
stakes we get from the model. Accumulated, site-specific, session-bound competence is ours alone.

That rule is what puts skills at the top and Firefox at the bottom.

---

## Next

### 1. Domain policy — where the agent may and may not go

**Why first:** the pitch is "it drives your real logged-in sessions." Today a user cannot say
_"never touch my bank."_ The plan gate is per-run consent, and the consequential-action rule
(`ask_user` before paying/sending/deleting) lives in the **system prompt** — the model can simply
not follow it. There is no enforced boundary anywhere in the codebase. For a product with this
much access, "trust the model" is not a security model, and it is the first thing a thoughtful
user (or a store reviewer) asks about.

**The mechanism is small. The semantics are the work.**

The cheap version — mirror `isRestrictedUrl` at the three tab-resolution sites in
`start-run.ts:533,558,574` — is about half a day and **leaks immediately**: the agent clicks a
link and is on the blocked domain, because `navigate` is not the only thing that navigates.

So the check belongs at the **act boundary in the driver**, not on the `navigate` tool: before any
action, the driven tab's _current_ URL is the thing that must be allowed. Open decisions:

| Question                       | Leaning                                                                                                                                                               |
| ------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Allowlist or blocklist?        | **Blocklist.** An allowlist is unusable for open-ended browsing, which is the product.                                                                                |
| Wildcards?                     | Registrable domain + subdomains (`*.chase.com`), no path patterns in v1.                                                                                              |
| What happens on a hit mid-run? | Refuse the action and tell the model why, so it can re-plan or `ask_user` — not a hard abort. A blocked page reached mid-task is usually a wrong turn, not an attack. |
| Does it survive adoption?      | Yes — adopting a blocked tab must fail at start, with the reason.                                                                                                     |
| Ship with defaults?            | No. A pre-seeded bank list would be wrong in every locale and reads as security theatre. Empty, with a settings pane and a good empty state.                          |

**Not in scope:** per-tool policy ("read but never click here"). That's a second axis and it can
wait for evidence that anyone wants it.

### 2. Skills — the compounding layer

The one that actually serves the bet. Five tiers, and **we already shipped tier 1 without calling
it that**: `memory/AGENTS.md` is a general, always-loaded skill.

| Tier                        | What                                                                                                       | State                                  |
| --------------------------- | ---------------------------------------------------------------------------------------------------------- | -------------------------------------- |
| 1. **General**              | Always-on standing instructions                                                                            | ✅ `memory/AGENTS.md`                  |
| 2. **Domain-scoped**        | Loads only when the run's tab matches a URL pattern — _"on Gmail, archive is the box icon, not the trash"_ | ⬜ next rung                           |
| 3. **Commands ("plugins")** | `/expenses` invokes a named recipe, with args                                                              | ⬜ host exists (`slash-commands.ts`)   |
| 4. **Learned**              | After a run that took real figuring-out, the agent offers to save what it worked out                       | ⬜ shape exists (`extractAndRemember`) |
| 5. **Waypoints**            | A skill stores _anchors_, not just prose — so run #2 doesn't re-snapshot its way to the same button        | ⬜ the differentiated one              |

**Tier 2 is the cheapest real step** and doesn't need a new storage model: a `url:` matcher on
sections of the existing docs, filtered by `loadAgentContext()` at run start. Ship that, see if
anyone's instructions file gets unwieldy, and let that decide whether tiers 3–5 are real.

**Tier 5 is the one nothing else can build.** A sandboxed agent starts cold on every task, so
site-specific waypoints have nowhere to accumulate. We come back to the same logged-in page every
day — that's a memory only this architecture can hold. Speculative, and named here so it isn't
forgotten.

**Open:** shareable skills (a skill is one markdown file; export/import by paste or URL) is the
"recipes" bet. It's a distribution play, not a capability, and it needs users first.

---

## Soon

### 3. Schedule follow-ups

Small, all confirmed against the code.

**Pause / resume** — genuinely simple. `paused?: boolean` was in the original plan and cut from
v1; add the field, `disarmSchedule` on pause, recompute `nextFireAt` from _now_ on resume (never
from the stale one). Settings row gets a toggle.

**"Run now" doesn't consume a one-shot** — logged as a bug, but it's **correct behaviour badly
communicated.** "Run now" is how you verify a schedule does what you meant before trusting it at
3am; consuming the one-shot would make testing it destroy it. The fix is copy, not logic: the row
should say the scheduled fire still stands.

**The real "Run now" problem is the one you named.** It fires into the _schedule's own_
conversation, not the panel's current one — so you click it in Settings and nothing visibly
happens. The fix is to close that loop: the row reports the run inline, and offers to open that
conversation.

**MCP exposure** of `schedule_task` / `cancel_schedule` — still deferred, same reason: an MCP
client scheduling browser work that fires long after the client is gone is a different trust story,
and it needs the domain policy under it first.

### 4. Deleting a scheduled conversation — a real bug today

`deleteConversation` (`conversations.ts:401`) cancels queued runs but **never looks at schedules**.
The schedule survives with a `conversationId` pointing at a dead thread, and at the next fire
`openScheduledConversation` → `ensureConversation` **re-creates the row with the same id**
(`conversations.ts:275`). So:

- The chat you deleted **comes back from the dead**, empty, at 9am.
- Worse: deleting the thread _looks_ like it stopped the recurring task. It didn't.

**These are two different objects with two different lifetimes.** Deleting a chat is housekeeping;
cancelling a schedule is a commitment change. Auto-deleting the schedule destroys unattended work
the user never asked to stop. Silently resurrecting is what we do now. Neither is defensible, so:

**Decision — surface the coupling at the one moment the information exists.** Deleting a
conversation a live schedule points at names the schedule in the confirm and offers both doors:
_delete the chat and cancel the schedule_ (default — someone deleting a scheduled thread almost
always means "stop this thing") or _delete the chat, keep it running_. Not a guess, and asked once.

**Backstop for the case nobody sees:** at fire time, if the conversation is gone, mint a **fresh
id**, note in the transcript that the earlier history was lost, and keep running — never silently
reuse the dead one. Also covers eviction, which is narrow but real: `appendTo` re-heads the index
on every message so an actively-firing schedule stays near the top, but a monthly one-shot three
weeks out can still fall off the 50-conversation cap.

**Alerting:** no notification for the delete (the user is right there, they'll see the confirm).
The fresh-conversation backstop _is_ worth a line in the transcript — silence there is how a
recurring task quietly forgets everything it knew.

### 5. File upload

"Attach the receipt to the expense form" is impossible today — 27 tools and none of them touches a
file input.

**Model capability tables are a non-issue here, and that's the key insight.** The model never
receives the file. It names _which attachment goes in which field_; the bytes go straight from the
panel into the page. The `imagesSupported` flag only governs images sent _to the model_ — a
different path entirely.

The real constraint is that **an extension has no filesystem**, so `DOM.setFileInputFiles` (which
takes local disk paths) is out. The route that works: the user attaches the file in the panel, and
a tool sets it into the input page-side by building a `File` from the bytes and assigning it
through a `DataTransfer` — plain page JS, over the `Runtime.evaluate` path that already exists.

**Prerequisite:** panel attachments are images-only today (`conversation/ui/image.ts`). Widening
them to arbitrary files is most of the work.

---

## Later

**Firefox** — the only survivor of the old roadmap, and still blocked: `chrome.debugger` has no
Firefox or Safari equivalent, and it's the whole driver. Not a port, a rewrite of the trusted-input
layer. Revisit only if a real user asks.

**Shareable skills** — see tier 5 above. Needs users first.

**Per-tool policy** — see domain policy. Needs evidence first.

---

## Deliberately not doing

|                                | Why                                                                                                                                                                                           |
| ------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Telemetry                      | The product's promise. Feedback is the user-initiated pre-filled issue (`lib/report.ts`) — nothing collected, nothing sent, the user presses Submit on GitHub or it never exists.             |
| Cron strings                   | Unreadable in a settings list and needs a parser. The structured `Recurrence` union covers every case anyone named. Cron can later become a _parser_ that emits it — never the storage model. |
| Sampling params                | No temperature/topP on any provider. The only knob is `reasoningEffort`.                                                                                                                      |
| A second scheduler for "loops" | A recurring schedule **is** a loop, and self-pacing falls out of giving the agent `schedule_task`. Two clocks on a one-slot run queue is a bug generator, not a feature.                      |
| Multi-run concurrency          | One CDP target, one run slot. A schedule firing mid-chat queues FIFO behind you. Concurrency here means two agents fighting over your keyboard.                                               |
