import { describe, it, expect } from "vitest";

// Storage stand-in and i18n come from src/test-setup.ts (vitest setupFiles).

import {
  appendMessage,
  conversationTitle,
  deleteConversation,
  getActiveId,
  getConversationTabs,
  getMessages,
  listConversations,
  recordDrivenTab,
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

  it("keeps every message when appends are fired in the same tick", async () => {
    // The regression: read-modify-write appends started together all read the
    // same array and the last write won, silently dropping the others — which
    // cost the next run the exchange it was asked to continue.
    await setActiveConversation(null);
    const ids = await Promise.all([
      appendMessage(msg("user", "propose names")),
      appendMessage(msg("assistant", "here is the list")),
      appendMessage(msg("user", "search them")),
    ]);

    expect(new Set(ids).size).toBe(1); // one conversation, not three
    expect((await getMessages(ids[0]!)).map((m) => m.content)).toEqual([
      "propose names",
      "here is the list",
      "search them",
    ]);
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

  it("remembers the tabs a conversation's runs drove, newest first", async () => {
    expect(await getConversationTabs()).toEqual([]); // fresh chat — no run yet

    const first = await appendMessage(msg("user", "check gmail"));
    await recordDrivenTab({ url: "https://mail.google.com/", title: "Inbox", tabId: 7 });
    await recordDrivenTab({ url: "https://docs.google.com/d/1", title: "Q3 Invoice", tabId: 9 });
    expect((await getConversationTabs()).map((t) => t.url)).toEqual([
      "https://docs.google.com/d/1",
      "https://mail.google.com/",
    ]);

    // Re-driving a tab moves it back to the front instead of duplicating it.
    await recordDrivenTab({ url: "https://mail.google.com/", title: "Inbox", tabId: 7 });
    expect((await getConversationTabs()).map((t) => t.url)).toEqual([
      "https://mail.google.com/",
      "https://docs.google.com/d/1",
    ]);

    // Later appends rewrite the index row without dropping the list.
    await appendMessage(msg("assistant", "done"));
    expect(await getConversationTabs()).toHaveLength(2);

    // Another conversation starts with no history of its own.
    await setActiveConversation(null);
    await appendMessage(msg("user", "unrelated task"));
    expect(await getConversationTabs()).toEqual([]);

    await setActiveConversation(first);
    expect((await getConversationTabs()).map((t) => t.url)).toEqual([
      "https://mail.google.com/",
      "https://docs.google.com/d/1",
    ]);
  });

  it("caps the tab list so a long multi-tab session stays bounded", async () => {
    await appendMessage(msg("user", "many tabs"));
    for (let i = 0; i < 8; i++) {
      await recordDrivenTab({ url: `https://site${i}.com/`, title: `Site ${i}` });
    }
    const tabs = await getConversationTabs();
    expect(tabs).toHaveLength(5);
    expect(tabs[0]?.url).toBe("https://site7.com/"); // newest work first
    expect(tabs.map((t) => t.url)).not.toContain("https://site2.com/"); // oldest evicted
  });
});
