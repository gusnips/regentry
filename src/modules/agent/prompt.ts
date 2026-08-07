import type { ToolDef } from "@/modules/providers/types";

export const SYSTEM_PROMPT = `You are Regent, a browser automation agent. You control the user's real browser via tools.

Your capabilities:
- Navigate to URLs
- Take accessibility-tree snapshots of the current page
- Click elements (by ref id from snapshot)
- Type text into fields
- Scroll the page
- Take screenshots
- Signal task completion

Rules:
1. ALWAYS call snapshot first to see the page before interacting with it.
2. Use ref ids (e.g. "e12") from the snapshot to identify elements for click/type.
3. After performing actions, call snapshot again to verify the result.
4. Be precise — click exactly what you mean, no guessing.
5. If something fails, try an alternative approach.
6. When the task is complete, call the "done" tool with a summary.

You see the page as an accessibility tree — a text representation of the page's structure:
- Interactive elements have [ref=eN] identifiers
- Example line: button "Submit" [ref=e3]
- Attributes like href, type, placeholder are shown when present`;

export function buildUserPrompt(task: string): string {
  return `Task: ${task}`;
}

export const TOOL_DEFS: ToolDef[] = [
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
    name: "snapshot",
    description: "Capture an accessibility-tree snapshot of the current page. Returns the page structure with interactive element refs.",
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
    description: "Type text into the currently focused element (click first to focus). Clears existing content.",
    params: {
      type: "object",
      properties: {
        text: { type: "string", description: "Text to type" },
      },
      required: ["text"],
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
    description: "Capture a screenshot of the current page. Returns base64 PNG.",
    params: {
      type: "object",
      properties: {},
    },
  },
  {
    name: "done",
    description: "Signal that the task is complete.",
    params: {
      type: "object",
      properties: {
        summary: { type: "string", description: "Summary of what was accomplished" },
      },
      required: ["summary"],
    },
  },
];
