#!/usr/bin/env bun
/**
 * End-to-end check for the bridge daemon: spawns it, plays the extension over
 * WebSocket, and drives it over MCP stdio exactly as a client would.
 *
 *   bun daemon/smoke.ts
 *
 * Asserts the parts that only break in the wiring — the hello/sync handshake,
 * request correlation, the long-poll waking on a pushed event, and the ask_user
 * question surviving the `done` that follows it. Exits non-zero on the first
 * failure; no framework, no fixtures.
 */
import type { DaemonMessage, ExtensionMessage } from "./src/protocol";
import { emptyStatus } from "./src/protocol";

const PORT = 17_999;
const EXTENSION_ID = "smoke-extension-id";

function check(label: string, ok: boolean, detail?: string): void {
  if (ok) {
    console.log(`  ✓ ${label}`);
    return;
  }
  console.error(`  ✗ ${label}${detail ? `\n    ${detail}` : ""}`);
  // Take the daemon down with us — a leaked one holds the port and every later
  // run then fails on the bind instead of on its own merits.
  daemon.kill();
  process.exit(1);
}

// ── The daemon under test ───────────────────────────────────────────

const daemon = Bun.spawn(["bun", "src/index.ts"], {
  cwd: import.meta.dir,
  env: {
    ...process.env,
    REGENTRY_BRIDGE_PORT: String(PORT),
    REGENTRY_BRIDGE_EXPECTED_EXTENSION_ID: EXTENSION_ID,
  },
  stdin: "pipe",
  stdout: "pipe",
  stderr: "inherit",
});

interface RpcResponse {
  id?: number;
  result?: { content?: { type: string; text?: string }[]; tools?: { name: string }[] };
  error?: { message: string };
}

const pending = new Map<number, (msg: RpcResponse) => void>();
let nextId = 1;

void (async () => {
  const decoder = new TextDecoder();
  let buffer = "";
  for await (const chunk of daemon.stdout) {
    buffer += decoder.decode(chunk);
    let cut = buffer.indexOf("\n");
    while (cut !== -1) {
      const line = buffer.slice(0, cut).trim();
      buffer = buffer.slice(cut + 1);
      if (line) {
        const msg = JSON.parse(line) as RpcResponse;
        if (msg.id !== undefined) pending.get(msg.id)?.(msg);
      }
      cut = buffer.indexOf("\n");
    }
  }
})();

function rpc(method: string, params?: unknown): Promise<RpcResponse> {
  const id = nextId++;
  daemon.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
  daemon.stdin.flush();
  return new Promise((resolve) => pending.set(id, resolve));
}

function notify(method: string): void {
  daemon.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", method })}\n`);
  daemon.stdin.flush();
}

const bodyOf = (msg: RpcResponse) =>
  msg.result?.content?.map((c) => c.text ?? `<${c.type}>`).join("\n") ?? "";

// ── The extension stand-in ──────────────────────────────────────────

let socket: WebSocket;
const requests: BridgeRequestSeen[] = [];
type BridgeRequestSeen = { requestId: string; method: string; params: Record<string, unknown> };
let onRequest: ((req: BridgeRequestSeen) => void) | null = null;

function send(msg: ExtensionMessage): void {
  socket.send(JSON.stringify(msg));
}

function reply(requestId: string, result: unknown): void {
  send({ type: "response", requestId, ok: true, result });
}

/**
 * Resolves with the next request the daemon makes for `method`, consuming it —
 * a cached match would otherwise hand the same request to a second call and
 * quietly assert nothing.
 */
function awaitRequest(method: string): Promise<BridgeRequestSeen> {
  const at = requests.findIndex((r) => r.method === method);
  if (at !== -1) return Promise.resolve(requests.splice(at, 1)[0] as BridgeRequestSeen);
  return new Promise((resolve) => {
    onRequest = (req) => {
      if (req.method !== method) return;
      onRequest = null;
      requests.splice(requests.indexOf(req), 1);
      resolve(req);
    };
  });
}

async function connectExtension(): Promise<void> {
  for (let attempt = 0; attempt < 40; attempt++) {
    try {
      const ws = new WebSocket(`ws://127.0.0.1:${PORT}/ws`);
      await new Promise<void>((resolve, reject) => {
        ws.onopen = () => resolve();
        ws.onerror = () => reject(new Error("connect failed"));
      });
      socket = ws;
      ws.onmessage = (e) => {
        const msg = JSON.parse(String(e.data)) as DaemonMessage;
        if (msg.type === "ping") return send({ type: "pong" });
        const req = { requestId: msg.requestId, method: msg.method, params: msg.params };
        requests.push(req);
        onRequest?.(req);
      };
      return;
    } catch {
      await Bun.sleep(50);
    }
  }
  throw new Error(`daemon never accepted a WebSocket on ${PORT}`);
}

// ── The run ─────────────────────────────────────────────────────────

console.log("regentry bridge — end-to-end smoke");

const init = await rpc("initialize", {
  protocolVersion: "2024-11-05",
  capabilities: {},
  clientInfo: { name: "smoke", version: "0" },
});
check("MCP initialize answers", !init.error, init.error?.message);
notify("notifications/initialized");

const tools = (await rpc("tools/list")).result?.tools?.map((t) => t.name) ?? [];
check(
  "every tool is registered",
  [
    "health",
    "run",
    "get_status",
    "answer",
    "steer",
    "stop",
    "screenshot",
    "new_conversation",
    "browser_start",
    "browser_snapshot",
    "browser_navigate",
    "browser_click",
    "browser_type",
    "browser_press_key",
    "browser_scroll",
    "browser_tabs",
    "browser_switch_tab",
    "browser_end",
  ].every((t) => tools.includes(t)),
  `got ${tools.join(", ")}`,
);

const offline = bodyOf(await rpc("tools/call", { name: "health", arguments: {} }));
check(
  "health reports the extension missing, with a way forward",
  offline.includes("connected: false") && offline.includes("side panel"),
);

const blocked = await rpc("tools/call", { name: "run", arguments: { task: "go to example.com" } });
check(
  "run refuses without an extension instead of hanging",
  bodyOf(blocked).includes("isn't connected"),
);

// The extension arrives: hello, then the daemon syncs its status.
await connectExtension();
send({ type: "hello", extensionId: EXTENSION_ID, version: "0.1.0" });
const sync = await awaitRequest("sync");
reply(sync.requestId, emptyStatus());
await Bun.sleep(50);

// health asks the extension what it has to think with, so the answer has to be
// served alongside the call rather than before it.
const healthCall = rpc("tools/call", { name: "health", arguments: {} });
const readyInfo = await awaitRequest("providerInfo");
reply(readyInfo.requestId, {
  name: "Anthropic (Subscription)",
  ready: true,
  auth: "subscription",
  model: null,
});
const online = bodyOf(await healthCall);
check(
  "health sees the expected extension",
  online.includes("connected: true") && online.includes("Ready"),
);
check(
  "health names the provider a run would think with",
  online.includes("Anthropic (Subscription)") && online.includes("model auto"),
);

// The failure this pre-empts: a reachable browser that has no model behind it.
const unreadyCall = rpc("tools/call", { name: "health", arguments: {} });
const unreadyInfo = await awaitRequest("providerInfo");
reply(unreadyInfo.requestId, { name: null, ready: false, auth: null, model: null });
const unready = bodyOf(await unreadyCall);
check(
  "health warns when no provider is configured, and says direct control still works",
  unready.includes("no provider is configured") && unready.includes("browser_start"),
);

// A run: the daemon forwards it, the extension acknowledges, events flow back.
const started = rpc("tools/call", { name: "run", arguments: { task: "read my inbox" } });
const runRequest = await awaitRequest("run");
check("the task reaches the extension verbatim", runRequest.params.task === "read my inbox");
reply(runRequest.requestId, { runId: "run-1", conversationId: "conv-1" });
check("run answers with its id", bodyOf(await started).includes("run-1"));

// Accepting the run must flip the buffer to running — the event stream only
// ever reports progress, so nothing else would say a task had begun.
const live = bodyOf(await rpc("tools/call", { name: "get_status", arguments: { wait: false } }));
check("the accepted run reads as running", live.includes("state: running"));

// get_status(wait) must park until something actually happens.
send({ type: "event", event: { type: "driving", tabId: 4, windowId: 1, title: "Inbox" } });
await Bun.sleep(50);
const waiting = rpc("tools/call", { name: "get_status", arguments: { waitSeconds: 5 } });
let woke = false;
void waiting.then(() => (woke = true));
await Bun.sleep(300);
check("get_status blocks while the run is quiet", !woke);
send({
  type: "event",
  event: { type: "step", tool: "navigate", summary: "Navigated successfully", ok: true },
});
const progress = bodyOf(await waiting);
check("a pushed step wakes the wait", woke && progress.includes("Navigated successfully"));
check("the driven tab is named", progress.includes("Inbox"));

// ask_user: the question is the closing state, even though a done follows it.
send({
  type: "event",
  event: {
    type: "question",
    question: "Pay the $42 invoice?",
    choices: ["Pay it now", "Not now"],
  },
});
send({ type: "event", event: { type: "done", summary: "waiting on you" } });
await Bun.sleep(50);
const asked = bodyOf(await rpc("tools/call", { name: "get_status", arguments: { wait: false } }));
check(
  "the question survives the done behind it",
  asked.includes("state: question") && asked.includes("$42"),
);
// The run is waiting on those exact words — a client that can't see them
// invents its own wording for the options.
check(
  "the offered choices reach the client verbatim",
  asked.includes("Pay it now") && asked.includes("Not now"),
);
check(
  "the model is told to relay the options, not just the question",
  asked.includes("relay this question AND its options"),
);
check(
  "the model is told not to decide consequential actions itself",
  asked.includes("never answer those yourself"),
);

const answered = rpc("tools/call", { name: "answer", arguments: { text: "yes, pay it" } });
const answerRequest = await awaitRequest("answer");
check("answer carries the user's words", answerRequest.params.text === "yes, pay it");
// The extension answers exactly as it does for run — an answer IS a run.
reply(answerRequest.requestId, { runId: "run-2", conversationId: "conv-1" });
await answered;
const resumed = bodyOf(await rpc("tools/call", { name: "get_status", arguments: { wait: false } }));
check("answering puts the thread back to work", resumed.includes("state: running"));

send({ type: "event", event: { type: "done", summary: "Paid. Receipt in the inbox." } });
await Bun.sleep(50);
const finished = bodyOf(
  await rpc("tools/call", { name: "get_status", arguments: { wait: false } }),
);
check(
  "the closing answer is served",
  finished.includes("state: done") && finished.includes("Receipt in the inbox"),
);

// A screenshot comes back as a real MCP image block.
const shot = rpc("tools/call", { name: "screenshot", arguments: {} });
const shotRequest = await awaitRequest("screenshot");
reply(shotRequest.requestId, {
  dataUrl: "data:image/jpeg;base64,/9j/4AAQSkZJRg==",
  tabId: 4,
  title: "Inbox",
  url: "https://mail.example.com/",
  driven: true,
});
const shotContent = (await shot).result?.content ?? [];
check(
  "screenshot returns an image the model can see",
  shotContent[0]?.type === "image" && (shotContent[1]?.text ?? "").includes("mail.example.com"),
);

// Stop must never report a no-op as success: a panel-owned run is untouchable
// from here, and "Stopped." would tell the model the browser was free.
const stoppedNothing = rpc("tools/call", { name: "stop", arguments: {} });
const idleStop = await awaitRequest("stop");
reply(idleStop.requestId, { stopped: false, panelBusy: true });
check(
  "a stop that stopped nothing says so, and names the panel",
  bodyOf(await stoppedNothing).includes("only the panel can stop it"),
);

const stoppedOurs = rpc("tools/call", { name: "stop", arguments: {} });
const realStop = await awaitRequest("stop");
reply(realStop.requestId, { stopped: false, panelBusy: false });
check("an idle stop is still not an error", bodyOf(await stoppedOurs).includes("Nothing to stop"));

// Direct control: the goal names the thread, and the opening snapshot rides
// back with it so the client's first move isn't a wasted round trip.
const driving = rpc("tools/call", {
  name: "browser_start",
  arguments: { goal: "find the Q3 invoice" },
});
const startRequest = await awaitRequest("browserStart");
check(
  "browser_start carries the goal and names the client from MCP initialize",
  startRequest.params.goal === "find the Q3 invoice" && startRequest.params.agent === "smoke",
);
reply(startRequest.requestId, { ok: true, data: { pageContent: '[ref=e1] link "Invoices"' } });
const drivingBody = bodyOf(await driving);
check(
  "browser_start returns the opening snapshot under the stated goal",
  drivingBody.includes("find the Q3 invoice") && drivingBody.includes('[ref=e1] link "Invoices"'),
);

// Every raw verb crosses as one browserAct method — the MCP surface is wide,
// the wire is narrow, and the extension keeps one browser implementation.
const clicking = rpc("tools/call", { name: "browser_click", arguments: { ref: "e1" } });
const clickRequest = await awaitRequest("browserAct");
check(
  "browser_click crosses the wire as browserAct with the agent tool name",
  clickRequest.params.tool === "click" &&
    (clickRequest.params.args as Record<string, unknown>).ref === "e1",
);
reply(clickRequest.requestId, { ok: true, data: { pageContent: '[ref=e7] link "invoice-q3"' } });
check(
  "an action hands back the page it produced, with the staleness warning",
  bodyOf(await clicking).includes("valid only for THIS snapshot"),
);

// A refused action reaches the model as a failed step, never a lying "ok" —
// a stale ref, a missing element, a dead tab. The error has to be visible.
const refused = rpc("tools/call", { name: "browser_click", arguments: { ref: "gone" } });
const refusedRequest = await awaitRequest("browserAct");
reply(refusedRequest.requestId, { ok: false, error: "No element with ref 'gone'." });
const refusedBody = bodyOf(await refused);
check(
  "a failed action says it failed, and why",
  refusedBody.includes("click: failed") && refusedBody.includes("No element with ref 'gone'."),
);

const scrolling = rpc("tools/call", {
  name: "browser_scroll",
  arguments: { direction: "up", amount: 200 },
});
const scrollRequest = await awaitRequest("browserAct");
check(
  "scroll direction picks the right underlying tool",
  scrollRequest.params.tool === "scroll_up" &&
    (scrollRequest.params.args as Record<string, unknown>).amount === 200,
);
reply(scrollRequest.requestId, { ok: true, data: {} });
await scrolling;

// An extension-side refusal reaches the model as an oriented error, not a crash.
const steered = rpc("tools/call", { name: "steer", arguments: { text: "use the search box" } });
const steerRequest = await awaitRequest("steer");
send({
  type: "response",
  requestId: steerRequest.requestId,
  ok: false,
  error: { code: "no-run", message: "No run is in progress to steer. Start one with run." },
});
check("a rejected command explains itself", bodyOf(await steered).includes("Start one with run"));

console.log("\nall checks passed");
daemon.kill();
process.exit(0);
