#!/usr/bin/env bun
/**
 * Regentry MCP bridge.
 *
 * Speaks MCP over stdio to one AI client, and WebSocket to the Regentry
 * extension, which is always the dialling side — an MV3 service worker cannot
 * listen on a socket, so the extension can never be an MCP server itself.
 *
 * The daemon is a pipe with a memory: it holds the run status so `get_status`
 * can long-poll (a browser task runs for minutes, and burning a model turn per
 * poll is the whole cost of getting this wrong) and so a dropped link never
 * loses a finished run's answer.
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { BridgeError, BridgeLink, NOT_CONNECTED } from "./link";
import type { BridgeStatus, CaptureResult } from "./protocol";
// One source of truth for the version, exactly as the extension does it.
import pkg from "../package.json" with { type: "json" };

const PORT = Number(process.env.REGENTRY_BRIDGE_PORT ?? 17_836);
/** The Chrome Web Store build. A dev build has its own id — set the env var. */
const EXPECTED_EXTENSION_ID =
  process.env.REGENTRY_BRIDGE_EXPECTED_EXTENSION_ID ?? "jlngbadknjppfbohhifabijkimigdiia";

/** Under a client's own timeout, so a wait ends as an answer, not a failure. */
const DEFAULT_WAIT_SECONDS = 30;
const MAX_WAIT_SECONDS = 55;
/** Enough to follow the work; the transcript in the panel keeps everything. */
const MAX_STEPS_SHOWN = 12;

const link = new BridgeLink(PORT);
link.listen();

// ── Output shaping ──────────────────────────────────────────────────

type Content = { type: "text"; text: string } | { type: "image"; data: string; mimeType: string };
const text = (body: string) => ({ content: [{ type: "text" as const, text: body }] });
const failure = (body: string) => ({
  content: [{ type: "text" as const, text: body }],
  isError: true as const,
});

/** Every tool answers the same way when the extension isn't there. */
async function withLink<T>(
  run: () => Promise<T>,
): Promise<T | { content: Content[]; isError: true }> {
  try {
    return await run();
  } catch (e) {
    if (e instanceof BridgeError) return failure(e.message);
    throw e;
  }
}

function elapsed(from: number | null, to: number | null): string {
  if (!from) return "";
  const seconds = Math.round(((to ?? Date.now()) - from) / 1000);
  if (seconds < 60) return `${seconds}s`;
  return `${Math.floor(seconds / 60)}m ${String(seconds % 60).padStart(2, "0")}s`;
}

function formatStatus(status: BridgeStatus): string {
  const lines: string[] = [];
  const took = elapsed(status.startedAt, status.finishedAt);

  switch (status.state) {
    case "idle":
      return "state: idle — no task has been started in this conversation yet. Start one with run.";
    case "running":
      lines.push(`state: running · ${took} so far`);
      break;
    case "question":
      lines.push(`state: question — Regentry stopped to ask you something (after ${took})`);
      break;
    case "done":
      lines.push(`state: done · ${took}`);
      break;
    case "error":
      lines.push(`state: error · ${took}`);
      break;
  }

  if (status.driving) {
    lines.push(`tab: ${status.driving.title || "(untitled)"} (window ${status.driving.windowId})`);
  }

  if (status.plan) {
    const { steps, current } = status.plan;
    lines.push(`plan: ${Math.min(current, steps.length)}/${steps.length}`);
    steps.forEach((step, i) => {
      lines.push(`  ${i < current ? "✓" : i === current ? "▸" : "·"} ${step}`);
    });
  }

  if (status.steps.length > 0) {
    const shown = status.steps.slice(-MAX_STEPS_SHOWN);
    const dropped = status.steps.length - shown.length;
    lines.push(
      `steps: ${status.steps.length}${dropped > 0 ? ` (oldest ${dropped} not shown)` : ""}`,
    );
    for (const step of shown) {
      lines.push(
        `  ${step.ok === false ? "✗" : step.ok ? "✓" : "·"} ${step.tool} — ${step.summary}`,
      );
    }
  }

  if (status.state === "question" && status.question) {
    lines.push("", `question: ${status.question}`);
    lines.push(
      "next: relay this question to the user and send their reply with answer. Regentry asks before consequential actions — paying, sending on someone's behalf, deleting, submitting — so never answer those yourself.",
    );
  }
  if (status.state === "done") {
    lines.push("", `answer: ${status.summary ?? "(the run ended without a closing summary)"}`);
  }
  if (status.state === "error" && status.error) {
    lines.push("", `error: ${status.error}`);
  }
  if (status.state === "running") {
    lines.push(
      "",
      "next: call get_status again to wait for the next change, or steer to nudge the run.",
    );
  }

  return lines.join("\n");
}

// ── MCP server ──────────────────────────────────────────────────────

const server = new McpServer({ name: "regentry", version: pkg.version });

server.registerTool(
  "health",
  {
    title: "Regentry health",
    description:
      "Check that the browser agent is reachable before driving it. Reports whether the Regentry extension is connected to this bridge, which extension it is, and what to do when it isn't. Call this first, and again after any connection error.",
  },
  async () => {
    const match = link.extension ? link.extension.id === EXPECTED_EXTENSION_ID : null;
    const lines = [
      `connected: ${link.connected}`,
      `port: ${PORT}`,
      `extension: ${link.extension ? `${link.extension.id} (v${link.extension.version})` : "none"}`,
      `expected extension: ${EXPECTED_EXTENSION_ID}`,
    ];
    if (link.problem) lines.push("", link.problem);
    else if (!link.connected) lines.push("", NOT_CONNECTED);
    else if (match === false) {
      lines.push(
        "",
        `A different extension is connected than the one expected.\nCause: this is probably an unpacked dev build, which gets its own id.\nFix: if you trust it, set REGENTRY_BRIDGE_EXPECTED_EXTENSION_ID=${link.extension?.id} for this daemon; otherwise load the Chrome Web Store build.`,
      );
    } else lines.push("", "Ready — start a browser task with run.");
    return text(lines.join("\n"));
  },
);

server.registerTool(
  "run",
  {
    title: "Run a browser task",
    description:
      "Give Regentry a task to do in the user's real Chrome, with their existing logins and sessions — navigate, read pages, click, type, fill forms, extract data. Describe the goal in plain language, as you would to a person; Regentry plans and executes the steps itself. Returns immediately: follow the run with get_status. The task runs in the tab the user is on, so say which site to start from when it matters.",
    inputSchema: {
      task: z.string().describe("What to do, in plain language. Include any URL to start from."),
      images: z
        .array(
          z.object({
            data: z.string().describe("Base64 image bytes, without a data: prefix."),
            mimeType: z.string().describe("e.g. image/png or image/jpeg"),
          }),
        )
        .optional()
        .describe("Images to attach to the task — a screenshot to match, a form to copy from."),
    },
  },
  async ({ task, images }) =>
    withLink(async () => {
      const result = await link.request<{ runId: string; conversationId: string }>("run", {
        task,
        agent: clientName(),
        ...(images?.length
          ? { images: images.map((i) => `data:${i.mimeType};base64,${i.data}`) }
          : {}),
      });
      link.startRun(result.runId, result.conversationId);
      return text(
        `Started. run ${result.runId}\nCall get_status to follow it — it blocks until something happens, so polling costs one turn per real change.`,
      );
    }),
);

server.registerTool(
  "get_status",
  {
    title: "Follow the run",
    description:
      "Where the current task stands: the plan, the steps taken, and — when it ends — the answer, the question it stopped on, or the error. By default this WAITS for the next change instead of returning immediately, so following a ten-minute task costs one call per real event. Keep calling it until state is done, error, or question.",
    inputSchema: {
      wait: z
        .boolean()
        .optional()
        .describe("Block until the run changes state (default true). false returns immediately."),
      waitSeconds: z
        .number()
        .optional()
        .describe(
          `How long to block, up to ${MAX_WAIT_SECONDS}s (default ${DEFAULT_WAIT_SECONDS}s).`,
        ),
    },
  },
  async ({ wait, waitSeconds }) => {
    const shouldWait = wait ?? true;
    if (shouldWait && link.status.state === "running") {
      const seconds = Math.min(Math.max(waitSeconds ?? DEFAULT_WAIT_SECONDS, 1), MAX_WAIT_SECONDS);
      await link.waitForChange(link.revision, seconds * 1000);
    }
    const body = formatStatus(link.status);
    // A disconnect mid-run is not the run dying — the extension keeps working
    // and re-syncs on reconnect. Say that, so nobody restarts a live task.
    return text(
      link.connected
        ? body
        : `${body}\n\n(the extension is not connected right now — ${NOT_CONNECTED})`,
    );
  },
);

server.registerTool(
  "answer",
  {
    title: "Answer Regentry's question",
    description:
      "Reply to the question a run stopped on (state: question) and let it continue. Regentry stops to ask before consequential actions — paying, sending on the user's behalf, deleting, submitting — so relay the question to the user and send THEIR decision, never your own.",
    inputSchema: { text: z.string().describe("The user's answer, in their words.") },
  },
  async ({ text: answerText }) =>
    withLink(async () => {
      // An answer starts a fresh run over the same thread — same claim as run.
      const result = await link.request<{ runId: string; conversationId: string }>("answer", {
        text: answerText,
      });
      link.startRun(result.runId, result.conversationId);
      return text("Answered — the run continues. Follow it with get_status.");
    }),
);

server.registerTool(
  "steer",
  {
    title: "Steer the running task",
    description:
      "Send a note into a task that is already running — a correction, an extra constraint, a change of approach. It lands between tool calls, so the run absorbs it without restarting. Use this instead of stop+run when the goal is still the same.",
    inputSchema: { text: z.string().describe("The note for the running agent.") },
  },
  async ({ text: note }) =>
    withLink(async () => {
      await link.request("steer", { text: note });
      return text("Sent — it lands between the next tool calls.");
    }),
);

server.registerTool(
  "stop",
  {
    title: "Stop the run",
    description:
      "Stop the current task. Stopping is normal control flow, not an error, and it leaves the browser exactly as it is — nothing is undone.",
  },
  async () =>
    withLink(async () => {
      const result = await link.request<{ stopped: boolean; panelBusy: boolean }>("stop");
      if (result.stopped) return text("Stopped.");
      // Never let a no-op stop read as "the browser is free now".
      return text(
        result.panelBusy
          ? "Nothing of yours was stopped — the task in flight was started from Regentry's own panel, and only the panel can stop it. Ask the user to stop it there, or wait."
          : "Nothing to stop — no task was running.",
      );
    }),
);

server.registerTool(
  "screenshot",
  {
    title: "See the browser",
    description:
      "A picture of what the browser is showing right now. Use it to check a result with your own eyes, or to see what a page looks like before describing a task. Works whether or not a task is running.",
  },
  async () =>
    withLink(async () => {
      const shot = await link.request<CaptureResult>("screenshot");
      const [, mimeType = "image/jpeg", data = ""] =
        /^data:([^;]+);base64,(.*)$/.exec(shot.dataUrl) ?? [];
      const caption = `${shot.title || "(untitled)"} — ${shot.url}${
        shot.driven ? "" : "\n(this is the visible tab; the task is driving a different one)"
      }`;
      return {
        content: [
          { type: "image" as const, data, mimeType },
          { type: "text" as const, text: caption },
        ],
      };
    }),
);

server.registerTool(
  "new_conversation",
  {
    title: "Start a fresh thread",
    description:
      "Forget the current thread and start clean. Regentry keeps one conversation for this bridge — each run continues the previous ones, so it remembers the pages it visited and what it found. Reset only when the new task has nothing to do with the old one.",
  },
  async () =>
    withLink(async () => {
      await link.request("newConversation");
      link.reset();
      return text("New thread — the next run starts with no history.");
    }),
);

// ── Direct control ──────────────────────────────────────────────────
//
// The other half of the bridge: for a client that would rather drive than
// delegate. Discrete browser_* tools because that is the shape models already
// know cold — but they all cross the wire as one `browserAct` method, so the
// extension keeps a single browser implementation and nothing can drift.
//
// The catch worth stating in every description: driving directly means
// Regentry's own model is not in the loop, and neither is its policy of
// stopping to ask before consequential actions. That rule is the client's to
// keep here.

/** What the client calls itself, from MCP initialize — history shows this. */
function clientName(): string {
  const info = server.server.getClientVersion();
  return info?.name ? `${info.name}` : "An MCP client";
}

async function act(tool: string, toolArgs: Record<string, unknown> = {}) {
  return withLink(async () => {
    const result = await link.request<{ data?: unknown; error?: string }>("browserAct", {
      tool,
      args: toolArgs,
    });
    return text(renderToolResult(tool, result));
  });
}

/** The page as the model needs to read it, plus whatever the action returned. */
function renderToolResult(tool: string, result: { data?: unknown; error?: string }): string {
  const data = (result.data ?? {}) as { pageContent?: string; tabs?: unknown[]; url?: string };
  const parts: string[] = [`${tool}: ok`];
  if (data.url) parts.push(`url: ${data.url}`);
  if (data.tabs) parts.push(JSON.stringify(data.tabs, null, 2));
  if (data.pageContent) {
    parts.push(
      "",
      "page (refs are valid only for THIS snapshot — act on them before the page changes):",
      data.pageContent,
    );
  }
  return parts.join("\n");
}

server.registerTool(
  "browser_start",
  {
    title: "Start driving the browser yourself",
    description:
      "Open a direct-control session and get the first page snapshot. Use this instead of run when you want to drive step by step rather than hand Regentry the whole task — run is still the better choice for anything long or open-ended, because Regentry's own model plans it. State the goal: it names the conversation the user will see in Regentry's history, and every action you take is recorded under it. IMPORTANT: driving directly bypasses Regentry's own model and its rule of stopping to ask before consequential actions — so paying, sending on the user's behalf, deleting, or submitting is yours to put to the user first.",
    inputSchema: {
      goal: z
        .string()
        .describe("What you're setting out to do, in the user's terms. Titles the conversation."),
    },
  },
  async ({ goal }) =>
    withLink(async () => {
      const result = await link.request<{ data?: unknown }>("browserStart", {
        goal,
        agent: clientName(),
      });
      return text(
        `Driving directly. The user sees this as "${goal}" in Regentry's history, with every action under it.\n\n${renderToolResult("snapshot", result)}`,
      );
    }),
);

server.registerTool(
  "browser_snapshot",
  {
    title: "Read the page",
    description:
      "The current page as an accessibility tree with a ref on every interactive element — this is how you see, and where every ref you click comes from. Refs belong to the snapshot that produced them: after anything changes the page, re-read before acting.",
  },
  async () => act("snapshot"),
);

server.registerTool(
  "browser_navigate",
  {
    title: "Go to a URL",
    description: "Navigate the driven tab and return the new page's snapshot.",
    inputSchema: { url: z.string().describe("Absolute URL, including the scheme.") },
  },
  async ({ url }) => act("navigate", { url }),
);

server.registerTool(
  "browser_click",
  {
    title: "Click an element",
    description:
      "Click by ref, as a real trusted event — not a synthetic dispatch a site can ignore. Returns the resulting page. Take the ref from the most recent snapshot.",
    inputSchema: { ref: z.string().describe('A ref from the latest snapshot, e.g. "e12".') },
  },
  async ({ ref }) => act("click", { ref }),
);

server.registerTool(
  "browser_type",
  {
    title: "Type text",
    description:
      "Type into whatever is focused — click the field first. Real keystrokes, so a site's own handlers fire. Returns the resulting page.",
    inputSchema: { text: z.string().describe("The text to type.") },
  },
  async ({ text: body }) => act("type", { text: body }),
);

server.registerTool(
  "browser_press_key",
  {
    title: "Press a key",
    description:
      'A single key press — "Enter" to submit, "Escape" to dismiss, "Tab" to move on. Returns the resulting page.',
    inputSchema: { key: z.string().describe('e.g. "Enter", "Escape", "Tab", "ArrowDown".') },
  },
  async ({ key }) => act("press_key", { key }),
);

server.registerTool(
  "browser_scroll",
  {
    title: "Scroll the page",
    description:
      "Scroll the driven tab and return what is now in view. Content below the fold is not in a snapshot until you scroll to it.",
    inputSchema: {
      direction: z.enum(["down", "up"]).describe("Which way to scroll."),
      amount: z.number().optional().describe("Pixels; defaults to about one screenful."),
    },
  },
  async ({ direction, amount }) =>
    act(direction === "up" ? "scroll_up" : "scroll_down", amount === undefined ? {} : { amount }),
);

server.registerTool(
  "browser_tabs",
  {
    title: "List open tabs",
    description: "Every open tab with its id, title and URL — find the one you need, then switch.",
  },
  async () => act("list_tabs"),
);

server.registerTool(
  "browser_switch_tab",
  {
    title: "Switch tabs",
    description:
      "Point every later action at another tab and bring it to the front. Trusted input needs the tab on screen, so this focuses it.",
    inputSchema: { tab_id: z.number().describe("A tab id from browser_tabs.") },
  },
  async ({ tab_id }) => act("switch_tab", { tab_id }),
);

server.registerTool(
  "browser_end",
  {
    title: "Stop driving",
    description:
      "Close the direct-control session, drop the on-page 'being controlled' badge, and hand the browser back. Call it when you're done — it also frees Regentry's panel to run tasks again. A session left open expires on its own after a few idle minutes.",
  },
  async () =>
    withLink(async () => {
      await link.request("browserEnd");
      return text("Done driving — the browser is the user's again.");
    }),
);

await server.connect(new StdioServerTransport());
console.error(`[regentry] MCP bridge ready — WebSocket on 127.0.0.1:${PORT}`);
