import { defineItem } from "@/lib/storage";
import type { Message } from "./types";

const historyItem = defineItem<Message[]>("conversation-history", []);

export async function getHistory(): Promise<Message[]> {
  return historyItem.get();
}

// ponytail: capped at 100 messages — an unbounded array in chrome.storage.local
// eventually hits quota and fails silently. Ceiling: very long sessions lose their
// oldest transcript entries; upgrade path is trimming smarter (keep errors) if asked.
const MAX_HISTORY = 100;

export async function appendMessage(msg: Message): Promise<void> {
  const list = await historyItem.get();
  await historyItem.set([...list, msg].slice(-MAX_HISTORY));
}

export async function clearHistory(): Promise<void> {
  await historyItem.set([]);
}
