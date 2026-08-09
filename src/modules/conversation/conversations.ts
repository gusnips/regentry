import { defineItem } from "@/lib/storage";
import { truncateTo } from "@/lib/format";
import { cancelQueued, listQueue } from "@/modules/agent/run-queue";
import type { Message } from "./types";

/** A tab the conversation's runs drove — lets the next run spot a tab change. */
export interface LastTab {
  /** The comparison key: tab ids die with their tabs, urls survive them. */
  url: string;
  title: string;
  /** Opportunistic hint only — may point at a long-closed tab. */
  tabId?: number;
}

/** List-view metadata — the list reads only this, never the message arrays. */
export interface ConversationMeta {
  id: string;
  /** First user message, truncated. Empty until one lands — the UI labels those. */
  title: string;
  createdAt: number;
  updatedAt: number;
  messageCount: number;
  /** Tabs this conversation's runs drove, most recently worked first. */
  tabs?: LastTab[];
  /**
   * The external client that drove this conversation ("Claude Code"), when it
   * wasn't the user's own panel. History shows it: a transcript the user never
   * started, with nothing saying where it came from, reads as a stranger in
   * their own browser.
   */
  agent?: string;
}

// ponytail: fixed caps keep chrome.storage.local under quota — unbounded
// transcripts eventually fail writes silently. Ceilings: a very long run loses
// its oldest messages, and the 51st conversation evicts the least recently
// touched one. Upgrade path is IndexedDB if transcripts must be permanent.
const MAX_MESSAGES = 100;
const MAX_CONVERSATIONS = 50;
const TITLE_LENGTH = 60;

/** Index of every stored conversation, most recently touched first. */
const indexItem = defineItem<ConversationMeta[]>("conversations", []);
/** Which conversation the panel is showing. null = a fresh one, not created yet. */
const activeItem = defineItem<string | null>("active-conversation", null);
/** One key per conversation — appending rewrites one transcript, not all of them. */
const messagesItem = (id: string) => defineItem<Message[]>(`conversation:${id}`, []);

export function listConversations(): Promise<ConversationMeta[]> {
  return indexItem.get();
}

export function watchConversations(cb: (list: ConversationMeta[]) => void): () => void {
  return indexItem.watch(cb);
}

export function getActiveId(): Promise<string | null> {
  return activeItem.get();
}

export function getMessages(id: string): Promise<Message[]> {
  return messagesItem(id).get();
}

/** Opens a conversation. null starts a fresh one, created on its first message. */
export function setActiveConversation(id: string | null): Promise<void> {
  return activeItem.set(id);
}

/**
 * A conversation spans the tabs its runs drove — one run per message, and the
 * user moves between messages. The list is the run-start note's source, so it
 * stays short: deduped by url, newest work first, capped.
 */
const MAX_CONVERSATION_TABS = 5;

/** The tabs a conversation's runs drove, most recently worked first. */
export async function getConversationTabsFor(id: string): Promise<LastTab[]> {
  const row = (await indexItem.get()).find((c) => c.id === id);
  return row?.tabs ?? [];
}

/** Records where a run drove — re-driving a tab moves it back to the front. */
export async function recordDrivenTabFor(id: string, tab: LastTab): Promise<void> {
  const list = await indexItem.get();
  if (!list.some((c) => c.id === id)) return;
  await indexItem.set(
    list.map((c) =>
      c.id === id
        ? {
            ...c,
            tabs: [tab, ...(c.tabs ?? []).filter((t) => t.url !== tab.url)].slice(
              0,
              MAX_CONVERSATION_TABS,
            ),
          }
        : c,
    ),
  );
}

/**
 * Creates the thread an external MCP client is about to drive, stamped with
 * which client it was. Called once when the bridge opens a thread; the goal or
 * task it writes next becomes the title, exactly as a panel task does.
 */
export async function openAgentConversation(id: string, agent: string): Promise<void> {
  await serialized(() => ensureConversation(id, agent));
}

/** First line of the task, trimmed to fit a list row. */
export function conversationTitle(text: string): string {
  const line = (text.trim().split("\n", 1)[0] ?? "").trim();
  return truncateTo(line, TITLE_LENGTH);
}

/**
 * Resolves the conversation's metadata, creating it if it doesn't exist — or
 * if the record was deleted mid-run and left the id dangling. Never touches the
 * active item: id-targeted writers (the bridge's MCP thread) use this without
 * disturbing the panel's open conversation.
 */
async function ensureConversation(id: string, agent?: string): Promise<ConversationMeta> {
  const list = await indexItem.get();
  const existing = list.find((c) => c.id === id);
  if (existing) return existing;

  const now = Date.now();
  const meta: ConversationMeta = {
    id,
    title: "",
    createdAt: now,
    updatedAt: now,
    messageCount: 0,
    ...(agent ? { agent } : {}),
  };
  const kept = [meta, ...list].slice(0, MAX_CONVERSATIONS);
  const evicted = list.slice(MAX_CONVERSATIONS - 1);
  await Promise.all(evicted.map((c) => messagesItem(c.id).remove()));
  await indexItem.set(kept);
  return meta;
}

/**
 * The conversation the panel's messages belong to. A fresh conversation (active
 * id null) is created lazily on its first message and becomes the active one;
 * a dangling id (deleted mid-run) is re-created under the same id.
 */
async function ensureActive(): Promise<ConversationMeta> {
  const activeId = await activeItem.get();
  if (activeId) {
    const list = await indexItem.get();
    const existing = list.find((c) => c.id === activeId);
    if (existing) return existing;
  }
  const meta = await ensureConversation(activeId ?? crypto.randomUUID());
  await activeItem.set(meta.id);
  return meta;
}

/**
 * Screenshots are captured for the model, not for scrollback: one run can take
 * a dozen and base64 in storage.local blows the quota outright. Attachments the
 * user sent stay — a transcript missing the image you pasted reads as if you
 * never sent it.
 *
 * ponytail: the ceiling is that a reopened conversation shows a screenshot
 * step's summary without its thumbnail. Upgrade path is IndexedDB blobs.
 */
function stripTransientImages(msg: Message): Message {
  if (msg.role === "user" || !msg.images) return msg;
  const stored = { ...msg };
  delete stored.images;
  return stored;
}

/**
 * Every stored write is read-modify-write, and the panel fires them from an
 * event stream: a run that streams prose and then lands a done summary starts
 * two appends in the same tick, both read the same array, and the second write
 * erases the first. Serializing them is what makes the transcript — and the
 * history the next run replays from it — complete.
 *
 * ponytail: one chain per JS context, not a cross-context lock. The ceiling is
 * that the worker's own append (the panel-closed breadcrumb) races the panel's;
 * it only happens as the panel dies, which is the moment it stops writing.
 */
let writes: Promise<unknown> = Promise.resolve();

function serialized<T>(op: () => Promise<T>): Promise<T> {
  const next = writes.then(op, op);
  // The chain must survive a failed write — swallow here, callers still see it.
  writes = next.catch(() => {});
  return next;
}

/** Appends to the active conversation and returns its id. */
export function appendMessage(msg: Message): Promise<string> {
  return serialized(() => appendTo(null, msg));
}

/** Appends to a specific conversation (the bridge's MCP thread) and returns its id. */
export function appendMessageTo(id: string, msg: Message): Promise<string> {
  return serialized(() => appendTo(id, msg));
}

async function appendTo(id: string | null, msg: Message): Promise<string> {
  const meta = id ? await ensureConversation(id) : await ensureActive();
  const item = messagesItem(meta.id);
  const messages = [...(await item.get()), stripTransientImages(msg)].slice(-MAX_MESSAGES);
  await item.set(messages);

  const updated: ConversationMeta = {
    ...meta,
    title: meta.title || (msg.role === "user" ? conversationTitle(msg.content) : ""),
    updatedAt: msg.timestamp,
    messageCount: messages.length,
  };
  // Re-heading the index is what keeps it sorted by recency.
  const list = await indexItem.get();
  await indexItem.set([updated, ...list.filter((c) => c.id !== meta.id)]);
  return meta.id;
}

/**
 * Rewrites one stored message in place. The plan card is state, not an entry:
 * appending every revision would bury the transcript in stale checklists.
 * Id-targeted — the writer replaces plan cards in whatever conversation the run
 * lives in.
 */
export function replaceMessageTo(id: string, msg: Message): Promise<void> {
  return serialized(() => replaceTo(id, msg));
}

async function replaceTo(id: string, msg: Message): Promise<void> {
  const item = messagesItem(id);
  const messages = await item.get();
  if (!messages.some((m) => m.id === msg.id)) return;
  await item.set(messages.map((m) => (m.id === msg.id ? stripTransientImages(msg) : m)));
}

export async function deleteConversation(id: string): Promise<void> {
  // Cancel its queued runs first — a waiting task's first write would
  // resurrect the transcript being deleted. No breadcrumb here, for the same
  // reason: writing one would recreate the ghost too.
  for (const q of listQueue()) {
    if (q.conversationId === id) cancelQueued(q.id);
  }
  await messagesItem(id).remove();
  await indexItem.set((await indexItem.get()).filter((c) => c.id !== id));
  if ((await activeItem.get()) === id) await activeItem.set(null);
}
