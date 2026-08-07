import { defineItem } from "@/lib/storage";
import type { Message } from "./types";

const historyItem = defineItem<Message[]>("conversation-history", []);

export async function getHistory(): Promise<Message[]> {
  return historyItem.get();
}

export async function appendMessage(msg: Message): Promise<void> {
  const list = await historyItem.get();
  await historyItem.set([...list, msg]);
}

export async function clearHistory(): Promise<void> {
  await historyItem.set([]);
}
