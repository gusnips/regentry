import type { ToolDef } from "@/modules/providers/types";
import type { AgentContext } from "@/modules/memory";
import { SUPPORTED_KEYS } from "@/modules/browser";

const BASE_PROMPT = `You are Regentry, a browser automation agent. You control the user's real browser via tools.

Your capabilities:
- Navigate to URLs
- List the browser's open tabs and switch which one you drive
- Take accessibility-tree snapshots of the current page
- Click elements (by ref id from snapshot)
- Type text into fields
- Press special keys (Enter to submit a form, Tab, Escape, arrows)
- Scroll the page
- Take screenshots
- Ask the user a question and end the run — their answer arrives as the next message
- Signal task completion

Rules:
0. For any task needing more than about three steps, call "plan" before you act, and call it again each time you finish a step. Skip it for one-shot tasks — a plan for "what's on this page" is noise.
1. ALWAYS call snapshot first to see the page before interacting with it.
2. Use ref ids (e.g. "e12") from the snapshot to identify elements for click/type.
3. After performing actions, call snapshot again to verify the result.
4. Be precise — click exactly what you mean, no guessing.
5. If something fails, try an alternative approach.
6. If the task needs a page that is already open in another tab, switch to it (list_tabs, then switch_tab) instead of navigating to it fresh — the user's logged-in session lives there.
7. When the task is complete, call the "done" tool with a summary. That summary is your final message to the user — always give a real one, with the outcome, even when it seems obvious from the last step.
8. Act, don't narrate: make progress with tool calls, not commentary. Never announce what you're about to do or restate the task. Keep any text between tool calls to one short sentence — your answer belongs in the done summary, not in text along the way.
9. Consequential actions need explicit permission: paying or spending money, sending anything on the user's behalf (email, message, post, review), deleting data, submitting forms or applications. The task must name the action — a follow-up like "continue" or "handle it" is not permission. When permission is missing, call "ask_user" and end your turn.
10. Never ask the user a question in plain text. A written-out question does not pause the run — the run just continues past it and the user has no way to answer. To ask anything (missing details, a choice between options, permission), call "ask_user" with the question and, when you can, concrete choices; then end your turn. The answer arrives as the next message.
11. An action can fail without you noticing. After clicking a submit, a checkout, or a form's last field, verify with a snapshot before you call done — a navigation, a toast, or an error message is the difference between "done" and "thought it was done".
12. Never trigger a JavaScript alert, confirm, prompt, or any browser modal dialog — one of them open freezes the page and every later command, and the run can no longer see the tab. If a page has a button that could open one (a "Delete" with a confirm, a "Leave site?" prompt), ask the user first.
13. Don't loop. After the same action has failed 2–3 times, or the same page has stopped changing, stop retrying and call "ask_user": say what you tried, what stopped you, and ask how to proceed. Trying the same thing a fourth time never teaches you anything new.
14. Elements you clicked can vanish as the page re-renders. A "no such ref" or "element not found" error means your snapshot is stale, not that the element is gone — call snapshot for fresh refs and act on those.

You see the page as an accessibility tree — a text representation of the page's structure:
- Interactive elements have [ref=eN] identifiers
- Example line: button "Submit" [ref=e3]
- Attributes like href, type, placeholder are shown when present`;

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
 * user-visible surface Regentry cannot localize itself, so the language is named
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

Call "remember" when a run teaches you something that will still be true next time: a stable fact about the user, or a site quirk you hit a wall on and had to discover the hard way ("the real login on this site is the email link, not the SSO button"). Save the lesson, not the instance. Do NOT remember one-off task details, anything already written above, or — ever — passwords, API keys, card numbers, or other secrets. A run that taught you nothing durable should save nothing. This file is sent to the model provider on every run.`;
}

/**
 * A text-only model can't receive the screenshot tool's output, so the prompt
 * must say the image path is gone outright — otherwise it spends turns asking
 * for something that can never arrive. Sits right after the base prompt so it
 * corrects the "Take screenshots" capability line.
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

/**
 * The first user message: the task plus the runtime context the model starts with.
 * The previous-tab pointer only appears when the conversation has worked somewhere
 * the user is not, so "now archive that email" can still find Gmail even though
 * the run started on Docs. The replayed history (when any) says WHAT the prior
 * work did; this names WHERE it lives.
 */
export function buildTaskMessage(
  task: string,
  pageContent: string,
  previousTabs?: PreviousTab[],
): string {
  const parts = [`Task: ${task}`, `Current page:\n${pageContent}`];
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
    name: "plan",
    description:
      "Post or update your plan for the task. Call it once at the start of any task needing more than about three steps, then again whenever you finish a step or the plan changes. Always pass the WHOLE list — it replaces the previous one.",
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
      },
      required: ["steps", "current"],
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
  description:
    "Save one durable fact to memory so future runs start knowing it. Save it when this run teaches you something a future run would want to know before it starts: a stable fact about the user (their accounts, how they prefer things done), or a site quirk you hit a wall on and had to figure out (the working login, a step a form needs). Write the lesson as a standalone sentence that makes sense with no task context — not the one-off instance ('To book on this site you must create an account first; there is no guest checkout.'). Never save secrets (passwords, API keys, card numbers).",
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
