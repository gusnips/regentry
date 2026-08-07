import { defineItem } from "@/lib/storage";
import { truncateTo } from "@/lib/format";
import type { Message } from "./types";

/** List-view metadata — the list reads only this, never the message arrays. */
export interface ConversationMeta {
  id: string;
  /** First user message, truncated. Empty until one lands — the UI labels those. */
  title: string;
  createdAt: number;
  updatedAt: number;
  messageCount: number;
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

/** First line of the task, trimmed to fit a list row. */
export function conversationTitle(text: string): string {
  const line = (text.trim().split("\n", 1)[0] ?? "").trim();
  return truncateTo(line, TITLE_LENGTH);
}

/**
 * The conversation messages belong to, creating it if the panel is on a fresh
 * one — or if the active record was deleted mid-run and left the id dangling.
 */
async function ensureActive(): Promise<ConversationMeta> {
  const activeId = await activeItem.get();
  const list = await indexItem.get();
  const existing = activeId ? list.find((c) => c.id === activeId) : undefined;
  if (existing) return existing;

  const now = Date.now();
  const meta: ConversationMeta = {
    id: activeId ?? crypto.randomUUID(),
    title: "",
    createdAt: now,
    updatedAt: now,
    messageCount: 0,
  };
  const kept = [meta, ...list].slice(0, MAX_CONVERSATIONS);
  const evicted = list.slice(MAX_CONVERSATIONS - 1);
  await Promise.all(evicted.map((c) => messagesItem(c.id).remove()));
  await indexItem.set(kept);
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

/** Appends to the active conversation and returns its id. */
export async function appendMessage(msg: Message): Promise<string> {
  const meta = await ensureActive();
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
 */
export async function replaceMessage(msg: Message): Promise<void> {
  const id = await activeItem.get();
  if (!id) return;
  const item = messagesItem(id);
  const messages = await item.get();
  if (!messages.some((m) => m.id === msg.id)) return;
  await item.set(messages.map((m) => (m.id === msg.id ? stripTransientImages(msg) : m)));
}

export async function deleteConversation(id: string): Promise<void> {
  await messagesItem(id).remove();
  await indexItem.set((await indexItem.get()).filter((c) => c.id !== id));
  if ((await activeItem.get()) === id) await activeItem.set(null);
}
