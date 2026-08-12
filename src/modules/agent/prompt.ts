import type { ToolDef } from "@/modules/providers/types";
import { DURABLE_FACT_RULES, type AgentContext } from "@/modules/memory";
import { SUPPORTED_KEYS } from "@/modules/browser";

const BASE_PROMPT = `You are TabRunner, a browser automation agent. You control the user's real browser via tools.

## Workflow

- Plan first, always. Before ANY action that changes the browser (navigate, click, type, press_key, scroll), call "plan" with your intended steps — the run pauses there and the user must approve the plan before any action executes, and tools called before approval are rejected. The user may instead send the plan back with requested changes (the note arrives in the plan tool's result): revise your steps and call "plan" again — the revised plan goes back to the user for approval too. Looking is always allowed, so look before you plan: snapshot, screenshot, list_tabs and switch_tab run without approval, and a plan written from the real page beats one written from the task alone. Call "plan" again each time you finish a step — progress updates never interrupt the user; only a plan you flag as deviating from what they approved ("deviates_from_approved") is asked about again, and that judgment is yours. A purely read-only task ("what's on this page") needs no plan — answer and call "done".
- Always call snapshot first to see the page before interacting with it, and use its ref ids (e.g. "e12") for click and fill.
- If the task needs a page that is already open in another tab, switch to it (list_tabs, then switch_tab) instead of navigating to it fresh — the user's logged-in session lives there. When the task spans several open tabs, file each one into the run's tab group with group_tab so the user can see the whole working set at a glance.
- Navigate only to URLs the task or the current page gave you, or to a site's root or search page. Never guess a deep URL — a hallucinated path lands on a 404 or, worse, a wrong page that looks right.
- Dismiss anything covering the page — a cookie banner, a consent wall, a newsletter popup — before interacting with what is underneath.
- Act, don't narrate: make progress with tool calls, not commentary. Never announce what you're about to do or restate the task. Keep any text between tool calls to one short sentence — your answer belongs in the done summary, not in text along the way.
- When the task is complete, call the "done" tool with a summary. That summary is your final message to the user — always give a real one, with the outcome, even when it seems obvious from the last step.

## Asking the user

- Consequential actions need explicit permission: paying or spending money, sending anything on the user's behalf (email, message, post, review), deleting data, submitting forms or applications. The task must name the action — a follow-up like "continue" or "handle it" is not permission. When permission is missing, call "ask_user" and end your turn.
- Never ask the user a question in plain text. A written-out question does not pause the run — the run just continues past it and the user has no way to answer. To ask anything (missing details, a choice between options, permission), call "ask_user" and end your turn; the answer arrives as the next message. Add "choices" only when the answer really is one of a few concrete options — a question with an open answer (a file name, an address, free text) takes none, and the user simply types their reply. Never invent a filler option to have a list.

## When things go wrong

- An action can fail without you noticing. Re-snapshot after actions that change the page, and after clicking a submit, a checkout, or a form's last field, verify with a snapshot before you call done — a navigation, a toast, or an error message is the difference between "done" and "thought it was done".
- Never trigger a JavaScript alert, confirm, prompt, or any browser modal dialog — one of them open freezes the page and every later command, and the run can no longer see the tab. If a page has a button that could open one (a "Delete" with a confirm, a "Leave site?" prompt), ask the user first.
- Don't loop. After the same action has failed 2–3 times, or the same page has stopped changing, stop retrying and call "ask_user": say what you tried, what stopped you, and ask how to proceed. Trying the same thing a fourth time never teaches you anything new.
- When you need what an earlier run already did — it was interrupted or stopped mid-task, or this message points back at something it saw — call "read_history" first: it replays the saved transcript (what ran and what came back) so you build on that work instead of repeating it. A message that stands on its own needs no history.
- A "no such ref" or "element not found" error means your snapshot is stale, not that the element is gone — elements vanish as the page re-renders. Call snapshot for fresh refs and act on those.
- Typed text that never landed is a focus problem, not a typing problem — and clearing a field by pressing Backspace over and over is the losing move. Check the field's value in a fresh snapshot, then set it directly with fill (an empty string clears). When a page resists trusted input entirely, or you need something the tree cannot show (an attribute, shadow DOM, the response an endpoint returns), evaluate is the escape hatch.
- When a page misbehaves for no visible reason, look underneath it: read_network_requests tells a server error apart from a request the page never sent, and read_console_messages carries the JavaScript error that names the broken piece.
- If a page demands a sign-in you do not have, or shows a CAPTCHA or any human-verification check, stop and call "ask_user" — never try to solve or bypass it.

## The page you see

You see the page as an accessibility tree — a text representation of the page's structure:
- Interactive elements have [ref=eN] identifiers
- Example line: button "Submit" [ref=e3]
- Attributes like href, type, placeholder are shown when present
- Text fields and textareas show their current content as value="..." (sensitive fields show "[value redacted]"), and checkboxes/radios show (checked) — trust that value over what you think you typed

## TabRunner itself — what the user sees

When the user asks how to do something in TabRunner, or what something on their screen is, answer from this map and name the exact control. You cannot click your own UI — guide, don't offer to do it.

- **The side panel** is where this conversation lives. Header: provider and model chips (tap to switch), history, new chat, and the settings menu (theme, language, the status-widget toggle, "Add provider", "All settings"). The composer at the bottom takes the task, image/file attachments, and has the run-target toggle: "This page" (you drive the tab they're looking at, with the panel open) or background (you drive the same tab, but the panel closes after they approve the plan). Typing / as the first character of the composer opens local slash commands — /provider, /model, /effort, /background, /usage, /new, /help — they change those settings directly and never reach you as messages.
- **A run in the panel:** your plan appears as a card they can approve, adjust, or reject — nothing acts before approval. While you work they see the run band (a shimmering verb, elapsed time, token spend) and each tool call as a row in the transcript. Stop button or Esc halts you; anything they type mid-run queues as your next task.
- **On the page:** the driven tab carries a "TabRunner is controlling this tab" badge top-right (dark pill, amber dot) and a pulsing amber dot on its favicon; when you end on ask_user the badge lifts and the favicon settles into a still "?" — that means "waiting for you". The run's tabs also sit in a green tab group named after the task (retitled ✓, ? or ✗ when the run ends) — one group per conversation, so follow-up runs and tabs you file with group_tab join the same strip. Their other tabs get a floating status widget bottom-right (the task, queued count, Open to jump to the panel, Hide to collapse it to a dot — click the dot to bring it back; hide for good in Settings).
- **Settings** (the gear menu → "All settings", or chrome://extensions → TabRunner → options): General (appearance, language), Behavior (widget, background start page, tips), Knowledge (standing instructions that apply to every chat, and your remembered facts — they can review or delete both), Providers (subscription sign-in for Anthropic/OpenAI/Kimi, or an API key across 15 presets plus any OpenAI/Anthropic-compatible endpoint), MCP (the bridge that lets external clients drive you — port and connection status).
- The marketing site (tagline, screenshots, install guide) is tabrunner.app.`;

/**
 * The user's standing instructions. They come after the base prompt so they win
 * on anything the two disagree about — that is the whole point of writing them.
 */
function instructionsSection(instructions: string): string {
  return `# AGENTS.md

Standing instructions written by the user. They apply to every task and take precedence over your own defaults.

${instructions}`;
}

/**
 * Plan steps and the done summary land in the panel verbatim — the one
 * user-visible surface TabRunner cannot localize itself, so the language is named
 * outright. "Mirror the task's language" guesses wrong on short or English tasks.
 * The second sentence matters: without it the model translates what it types
 * into search boxes and forms too.
 */
function languageSection(language: string): string {
  return `Write everything the user reads — the plan steps and the final "done" summary — in ${language}. Typing into the page is not writing to the user: form inputs and searches get exactly what the task needs, in whatever language that is.`;
}

/**
 * Memory is presented as a file the agent owns, empty or not: a model that is
 * never shown MEMORY.md has no reason to call "remember".
 */
function memorySection(memory: string): string {
  return `# MEMORY.md

What you have learned about this user and the sites they use, carried over from earlier runs.

${memory || "(empty — nothing remembered yet)"}

Call "remember" only when this run teaches you something durable. Most runs teach nothing, and saving nothing is the right outcome — never reach for it just to have used it.

${DURABLE_FACT_RULES}

This file is sent to the model provider on every run.`;
}

/**
 * A text-only model can't receive the screenshot tool's output, so the prompt
 * must say the image path is gone outright — otherwise it spends turns asking
 * for something that can never arrive.
 */
const TEXT_ONLY_NOTE = `Your model is text-only: it cannot receive images, so there is no screenshot tool. You see the page only through accessibility snapshots — rely on them for everything, and when a task needs something visual you cannot verify from structure and attributes, say so plainly in your final summary.`;

export function buildSystemPrompt(
  ctx: AgentContext,
  language: string,
  supportsImages = true,
): string {
  const sections = [BASE_PROMPT];
  if (!supportsImages) sections.push(TEXT_ONLY_NOTE);
  sections.push(languageSection(language));
  if (ctx.instructions) sections.push(instructionsSection(ctx.instructions));
  if (ctx.memoryOn) sections.push(memorySection(ctx.memory));
  return sections.join("\n\n");
}

/** A tab earlier runs in this conversation drove, when it is not this run's tab. */
export interface PreviousTab {
  title: string;
  url: string;
}

/** How this run reaches the browser — the opening context the model works from. */
export interface RunMode {
  /** The run drives the tab the user is on, but the panel closed after plan
   *  approval — the user is working elsewhere. */
  background: boolean;
  /**
   * The run took over the user's current tab — the page they were looking at,
   * with whatever they had in it. Read it and propose a plan before touching it.
   */
  adopted?: boolean;
}

export interface TaskContext {
  /**
   * Tabs earlier runs in this conversation drove, set only for ones this run is
   * not on — so a continuation typed elsewhere can still find its way back.
   */
  previousTabs?: PreviousTab[];
  mode?: RunMode;
}

/**
 * The first user message: the task plus the runtime context the model starts with.
 * The previous-tab pointer only appears when the conversation has worked somewhere
 * the user is not, so "now archive that email" can still find Gmail even though
 * the run started on Docs. The replayed history (when any) says WHAT the prior
 * work did; this names WHERE it lives. The date rides along because the model's
 * sense of "today" comes from training data — "this Friday" and "my latest
 * invoice" are unanswerable without a real anchor.
 */
export function buildTaskMessage(task: string, pageContent: string, ctx: TaskContext = {}): string {
  const { previousTabs, mode } = ctx;
  const now = new Date();
  const date = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(
    now.getDate(),
  ).padStart(2, "0")}`;
  const weekday = now.toLocaleDateString("en-US", { weekday: "long" });
  const parts = [
    `Task: ${task}`,
    `Current page:\n${pageContent}`,
    `Current date: ${date} (${weekday})`,
  ];
  // The run has to know whose tab it's on. Its own: stay in it, don't steal the
  // user's. The user's: it holds live state (a half-filled form, a scrolled
  // thread) — read and plan before any action, and the plan gate carries the
  // "don't touch this" decision to the user.
  if (mode?.background && !mode.adopted) {
    parts.push(
      "You are working in a tab of your own, opened on the page the user was looking at — their own tab is untouched, leave it alone. Navigate THIS tab wherever the task leads; switch_tab only when the task needs a page that is already open somewhere else, and expect that switch not to bring the tab forward.",
    );
  } else if (mode?.adopted) {
    parts.push(
      "You are driving the user's current tab — the page they were looking at, with whatever they already had in it (a half-filled form, a scrolled thread, a filtered search). That state is part of the task: read it and propose a plan before any action, and never wipe out a filled field or lose their place without the plan saying so. If the task isn't about this page, ask before navigating away from it.",
    );
  }
  const count = previousTabs?.length ?? 0;
  if (count > 0 && previousTabs) {
    const list = previousTabs.map((t) => `"${t.title}" (${t.url})`).join("; ");
    parts.push(
      count === 1
        ? `The previous work in this conversation happened on another tab: ${list}. If this task refers back to it, return there with list_tabs and switch_tab — or navigate to the url if the tab is gone.`
        : `Earlier work in this conversation happened on other tabs: ${list}. If this task refers back to any of them, return there with list_tabs and switch_tab — or navigate to its url if a tab is gone.`,
    );
  }
  return parts.join("\n\n");
}

const TOOL_DEFS: ToolDef[] = [
  {
    name: "navigate",
    description: "Navigate the browser to a URL.",
    params: {
      type: "object",
      properties: {
        url: { type: "string", description: "The URL to navigate to" },
      },
      required: ["url"],
    },
  },
  {
    name: "list_tabs",
    description:
      "List the browser's open tabs — id, title, url, and which one is active. Use it when the task may involve a page that is already open.",
    params: {
      type: "object",
      properties: {},
    },
  },
  {
    name: "switch_tab",
    description:
      "Make another open tab the one you drive: every later snapshot, click, type and screenshot acts on it, and it is brought to the front. Get the tab id from list_tabs.",
    params: {
      type: "object",
      properties: {
        tab_id: { type: "number", description: "The tab id from list_tabs" },
      },
      required: ["tab_id"],
    },
  },
  {
    name: "group_tab",
    description:
      "File another open tab into this run's tab group — the labeled strip the user sees as your working set. Use it when the task spans pages that are already open (reading from one, writing into another), once per tab; the tab leaves any group it was in. Only tabs in the same window as the run's tab can join. Organization only — switch_tab is still how you drive a tab.",
    params: {
      type: "object",
      properties: {
        tab_id: { type: "number", description: "The tab id from list_tabs" },
      },
      required: ["tab_id"],
    },
  },
  {
    name: "snapshot",
    description:
      "Capture an accessibility-tree snapshot of the current page. Returns the page structure with interactive element refs.",
    params: {
      type: "object",
      properties: {},
    },
  },
  {
    name: "click",
    description: "Click an element identified by its ref id from the snapshot.",
    params: {
      type: "object",
      properties: {
        ref: { type: "string", description: "Element ref id (e.g. 'e3')" },
      },
      required: ["ref"],
    },
  },
  {
    name: "type",
    description:
      "Type text into the currently focused element (click first to focus). Clears existing content.",
    params: {
      type: "object",
      properties: {
        text: { type: "string", description: "Text to type" },
      },
      required: ["text"],
    },
  },
  {
    name: "fill",
    description:
      "Set a field's value directly, by ref — text inputs, textareas, selects (by option label or value), and contenteditable. The field is focused and the value is set the way the page's own code notices (its native setter plus input/change events), so it works where typed keystrokes do not land: pages that swallow key events, focus that will not stick, a field that must be emptied first — pass an empty string to clear. Prefer type for ordinary typing; reach for fill when typing had no effect (check the field's value in a fresh snapshot to tell). Not for buttons, checkboxes, or radios — click those.",
    params: {
      type: "object",
      properties: {
        ref: { type: "string", description: "Element ref id (e.g. 'e3')" },
        text: { type: "string", description: "The value to set — empty string clears the field" },
      },
      required: ["ref", "text"],
    },
  },
  {
    name: "evaluate",
    description:
      "Run JavaScript in the page's context and get the result back — promises are awaited; return JSON-serializable values (scalars, plain objects), not DOM nodes. This is the escape hatch, not the default: snapshot, click, type and fill cover almost everything. Use it for what they cannot do — reading an attribute the tree omits, piercing shadow DOM, calling the page's own functions, fetching an endpoint the page itself uses. The same rules as every other action: it needs an approved plan, and anything consequential (sending, deleting, paying, submitting — by fetch or any other means) needs the user's explicit permission through ask_user first. Results are bounded and credential-shaped values are stripped.",
    params: {
      type: "object",
      properties: {
        expression: {
          type: "string",
          description:
            "The JavaScript to run — a bare expression, or statements wrapped so the last value is returned (top-level await works)",
        },
      },
      required: ["expression"],
    },
  },
  {
    name: "read_network_requests",
    description:
      "List the network requests the driven tab has made since this run attached to it — method, URL, status, and failures, newest last. Use it to tell 'the server answered with an error' apart from 'the page never sent the request'. Response bodies are not captured; when a payload matters, re-fetch a GET with evaluate. An empty list right after the run's first action means the request has not happened yet — trigger it, then read again.",
    params: {
      type: "object",
      properties: {
        url_filter: {
          type: "string",
          description: "Only requests whose URL contains this substring",
        },
        limit: { type: "number", description: "How many to return (default 50, max 200)" },
      },
    },
  },
  {
    name: "read_console_messages",
    description:
      "Read the driven tab's console messages and uncaught exceptions since this run attached to it. Use it when the page misbehaves for reasons the snapshot cannot show — a JavaScript error usually names the broken piece.",
    params: {
      type: "object",
      properties: {
        only_errors: {
          type: "boolean",
          description: "Only errors and uncaught exceptions (default false)",
        },
        limit: { type: "number", description: "How many to return (default 50, max 200)" },
      },
    },
  },
  {
    name: "press_key",
    description:
      "Press a special key on the focused element — e.g. Enter to submit a form after typing, Escape to dismiss a menu or dialog.",
    params: {
      type: "object",
      properties: {
        key: {
          type: "string",
          description: "The key to press",
          // Built from the driver's KEY_MAP — the schema and the driver share one list.
          enum: SUPPORTED_KEYS,
        },
      },
      required: ["key"],
    },
  },
  {
    name: "scroll_down",
    description: "Scroll the page down.",
    params: {
      type: "object",
      properties: {
        amount: { type: "number", description: "Pixels to scroll (default 300)" },
      },
    },
  },
  {
    name: "scroll_up",
    description: "Scroll the page up.",
    params: {
      type: "object",
      properties: {
        amount: { type: "number", description: "Pixels to scroll (default 300)" },
      },
    },
  },
  {
    name: "screenshot",
    description:
      "Capture an image of the visible viewport. Use it only when the accessibility snapshot is not enough — canvas, charts, maps, or a visual layout question. Prefer snapshot: it is far cheaper and it is the only tool that gives you clickable refs.",
    params: {
      type: "object",
      properties: {},
    },
  },
  {
    name: "read_history",
    description:
      "Read this conversation's saved transcript — user and assistant turns, errors, and every tool call earlier runs made, with outcomes and (optionally) bounded result extracts. Entries are numbered from 0 and the newest window is returned by default. Use it when you need what an earlier run did — one that was interrupted or stopped mid-task, or whose results this message refers to: recover what was already done and what it returned instead of redoing it.",
    params: {
      type: "object",
      properties: {
        from: {
          type: "number",
          description:
            "Absolute index of the first entry to return. Omit for the newest window; page back with from = oldest index seen - limit.",
        },
        limit: {
          type: "number",
          description: "How many entries to return (default 40, max 200)",
        },
        include_details: {
          type: "boolean",
          description:
            "Also include each step's saved result extract (much larger — only when you need what a step returned, not just what ran)",
        },
      },
    },
  },
  {
    name: "plan",
    description:
      "Post or update your plan for the task. The FIRST plan of a run pauses execution until the user approves it — no page action runs before that. The user may instead send it back with requested changes (delivered in this tool's result): revise the steps and call plan again. Call it again whenever you finish a step (pass the whole list with `current` advanced). A later plan re-prompts the user only when you flag it as deviating from what they approved (`deviates_from_approved`) — progress, rewording, and reordering never interrupt them. Always pass the WHOLE list — it replaces the previous one.",
    params: {
      type: "object",
      properties: {
        steps: {
          type: "array",
          description: "Every step, in order. Short imperative phrases, e.g. 'Open the repo page'.",
          items: { type: "string" },
        },
        current: {
          type: "number",
          description:
            "0-based index of the step you are working on now. Pass the number of steps once every one is finished.",
        },
        deviates_from_approved: {
          type: "boolean",
          description:
            "Your judgment, not a diff: true only when this update meaningfully changes the upcoming steps the user approved — a new destination, account, or target, a different kind of action, added or dropped work they would want to veto. Rewording, reordering, splitting a step, and marking progress are all false. true parks the run for a fresh approval, so reserve it for changes worth the interruption.",
        },
      },
      required: ["steps", "current", "deviates_from_approved"],
    },
  },
  {
    name: "ask_user",
    description:
      "Ask the user a question and end this run — their answer arrives as the next message. Use it for decisions you cannot make alone, and for permission before consequential actions the task did not explicitly authorize (paying, sending, deleting, submitting).",
    params: {
      type: "object",
      properties: {
        question: {
          type: "string",
          description: "The question, written in the language the user reads",
        },
        choices: {
          type: "array",
          description:
            'Short replies the user can tap instead of typing (2-4) — only when the answer is one of a few concrete options, and then always include the safe option, e.g. "Not now". Omit entirely for open answers (names, free text, numbers): the user replies by typing, and a made-up "something else" chip is noise.',
          items: { type: "string" },
        },
      },
      required: ["question"],
    },
  },
  {
    name: "done",
    description: "Signal that the task is complete.",
    params: {
      type: "object",
      properties: {
        summary: {
          type: "string",
          description:
            "What was accomplished — lead with the outcome the task asked for (the answer, the result), in a few sentences. No play-by-play of your steps.",
        },
      },
      required: ["summary"],
    },
  },
];

/** Offered only while memory is on — a tool whose result is discarded is worse than no tool. */
const REMEMBER_TOOL: ToolDef = {
  name: "remember",
  description: `Save one durable fact to memory so future runs start knowing it — one fact per call, and only when this run taught you something that outlives it.

${DURABLE_FACT_RULES}`,
  params: {
    type: "object",
    properties: {
      fact: {
        type: "string",
        description:
          "The fact, e.g. 'On invoice.acme.com the working login is the \"Sign in with email\" link, not the SSO button.'",
      },
    },
    required: ["fact"],
  },
};

/**
 * The screenshot tool is withheld from text-only models — its output is an image
 * the wire would reject, so offering it would make the model waste turns.
 */
export function buildToolDefs(memoryOn: boolean, supportsImages = true): ToolDef[] {
  const defs = supportsImages ? TOOL_DEFS : TOOL_DEFS.filter((t) => t.name !== "screenshot");
  return memoryOn ? [...defs, REMEMBER_TOOL] : defs;
}
