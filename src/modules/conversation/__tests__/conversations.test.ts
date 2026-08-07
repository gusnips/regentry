import { describe, it, expect, vi } from "vitest";

// In-memory stand-in for chrome.storage.local — one entry per defineItem key,
// which is what makes the per-conversation key scheme observable here.
vi.mock("wxt/utils/storage", () => {
  const values = new Map<string, unknown>();
  return {
    storage: {
      defineItem: <T>(key: string, opts: { fallback: T }) => ({
        getValue: () => Promise.resolve(values.has(key) ? (values.get(key) as T) : opts.fallback),
        setValue: (v: T) => {
          values.set(key, v);
          return Promise.resolve();
        },
        removeValue: () => {
          values.delete(key);
          return Promise.resolve();
        },
        watch: () => () => {},
      }),
    },
  };
});

import {
  appendMessage,
  conversationTitle,
  deleteConversation,
  getActiveId,
  getMessages,
  listConversations,
  setActiveConversation,
} from "../conversations";
import type { Message } from "../types";

let seq = 0;
function msg(role: Message["role"], content: string): Message {
  return { id: `m${++seq}`, role, content, timestamp: 1_000 + seq };
}

describe("conversationTitle", () => {
  it("takes the first line and truncates long tasks", () => {
    expect(conversationTitle("  go to hn\nand summarize  ")).toBe("go to hn");
    expect(conversationTitle("x".repeat(80))).toHaveLength(60);
  });
});

describe("conversations", () => {
  it("creates on first append, titles from the user message, tracks recency", async () => {
    const first = await appendMessage(msg("user", "book a flight to Lisbon"));
    await appendMessage(msg("assistant", "done"));

    expect(await getActiveId()).toBe(first);
    expect(await listConversations()).toEqual([
      expect.objectContaining({ id: first, title: "book a flight to Lisbon", messageCount: 2 }),
    ]);

    // "New chat" — a fresh transcript, created lazily by its own first message.
    await setActiveConversation(null);
    const second = await appendMessage(msg("user", "summarize this PR"));
    expect(second).not.toBe(first);

    const list = await listConversations();
    expect(list.map((c) => c.id)).toEqual([second, first]); // newest touched first
    expect(await getMessages(first)).toHaveLength(2); // the first transcript survives

    // Reopening an old conversation appends to it and re-heads the list.
    await setActiveConversation(first);
    await appendMessage(msg("user", "and again"));
    expect((await listConversations()).map((c) => c.id)).toEqual([first, second]);
    expect((await listConversations())[0]?.title).toBe("book a flight to Lisbon"); // title is sticky
  });

  it("delete drops the transcript, its index entry, and the active pointer", async () => {
    await setActiveConversation(null);
    const id = await appendMessage(msg("user", "throwaway task"));

    await deleteConversation(id);

    expect(await getMessages(id)).toEqual([]);
    expect((await listConversations()).some((c) => c.id === id)).toBe(false);
    expect(await getActiveId()).toBeNull();
  });

  it("re-creates a conversation whose record was deleted mid-run", async () => {
    await setActiveConversation(null);
    const id = await appendMessage(msg("user", "long run"));
    await deleteConversation(id);
    await setActiveConversation(id); // dangling id, as a racing run would leave it

    await appendMessage(msg("step", "clicked"));

    expect((await listConversations()).some((c) => c.id === id)).toBe(true);
    expect(await getMessages(id)).toHaveLength(1);
  });
});
