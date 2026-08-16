import { describe, it, expect } from "vitest";

// Storage stand-in and i18n come from src/test-setup.ts (vitest setupFiles).

import {
  appendMessageFresh,
  appendMessageTo,
  conversationTitle,
  deleteConversation,
  getActiveId,
  getThreadTabsFor,
  getMessages,
  listConversations,
  recordDrivenTabFor,
  setActiveConversation,
} from "../conversations";
import type { Message } from "../types";

let seq = 0;
function msg(role: Message["role"], content: string): Message {
  return { id: `m${++seq}`, role, content, timestamp: 1_000 + seq };
}

/** The driven-tab half of the thread record — what most of these assert on. */
const threadTabs = async (id: string) => (await getThreadTabsFor(id)).tabs;

describe("conversationTitle", () => {
  it("takes the first line and truncates long tasks", () => {
    expect(conversationTitle("  go to hn\nand summarize  ")).toBe("go to hn");
    expect(conversationTitle("x".repeat(80))).toHaveLength(60);
  });
});

describe("conversations", () => {
  it("creates on first append, titles from the user message, tracks recency", async () => {
    const first = await appendMessageFresh(msg("user", "book a flight to Lisbon"));
    await appendMessageTo(first, msg("step", "click"));
    await appendMessageTo(first, msg("assistant", "done"));

    expect(await getActiveId()).toBe(first);
    // One task, not three entries: the count is what the user sent, so a run's
    // steps and replies can't peg every history row at the transcript cap.
    expect(await listConversations()).toEqual([
      expect.objectContaining({ id: first, title: "book a flight to Lisbon", taskCount: 1 }),
    ]);

    // "New chat" — a fresh transcript, created by its own first message.
    const second = await appendMessageFresh(msg("user", "summarize this PR"));
    expect(second).not.toBe(first);

    const list = await listConversations();
    expect(list.map((c) => c.id)).toEqual([second, first]); // newest touched first
    expect(await getMessages(first)).toHaveLength(3); // the first transcript survives

    // Reopening an old conversation appends to it and re-heads the list.
    await appendMessageTo(first, msg("user", "and again"));
    expect((await listConversations()).map((c) => c.id)).toEqual([first, second]);
    expect((await listConversations())[0]?.title).toBe("book a flight to Lisbon"); // title is sticky
  });

  it("a fresh thread's opener never files under a re-pointed active slot", async () => {
    // The "conversation switched itself" regression: between "New conversation"
    // and the first message, a pill or notification click re-points the shared
    // active slot at the run's thread. Resolving that slot on append would
    // file the fresh opener under THAT thread — the panel adopts the id, keeps
    // rendering the live stream, and the old transcript materializes at run
    // end. The fresh append mints its own id instead of reading the slot.
    const old = await appendMessageFresh(msg("user", "the thread a run is working"));
    await setActiveConversation(old); // the click lands before the first keystroke

    const fresh = await appendMessageFresh(msg("user", "what the fresh thread asked"));

    expect(fresh).not.toBe(old);
    expect((await getMessages(old)).map((m) => m.content)).toEqual(["the thread a run is working"]);
    expect(await getActiveId()).toBe(fresh);
  });

  it("delete drops the transcript, its index entry, and the active pointer", async () => {
    const id = await appendMessageFresh(msg("user", "throwaway task"));

    await deleteConversation(id);

    expect(await getMessages(id)).toEqual([]);
    expect((await listConversations()).some((c) => c.id === id)).toBe(false);
    expect(await getActiveId()).toBeNull();
  });

  it("keeps every message when appends are fired in the same tick", async () => {
    // The regression: read-modify-write appends started together all read the
    // same array and the last write won, silently dropping the others — which
    // cost the next run the exchange it was asked to continue.
    const id = await appendMessageFresh(msg("user", "propose names"));
    await Promise.all([
      appendMessageTo(id, msg("assistant", "here is the list")),
      appendMessageTo(id, msg("user", "search them")),
    ]);

    expect((await getMessages(id)).map((m) => m.content)).toEqual([
      "propose names",
      "here is the list",
      "search them",
    ]);
  });

  it("re-creates a conversation whose record was deleted mid-run", async () => {
    const id = await appendMessageFresh(msg("user", "long run"));
    await deleteConversation(id);

    // A racing run's write re-creates the record under the same id.
    await appendMessageTo(id, msg("step", "clicked"));

    expect((await listConversations()).some((c) => c.id === id)).toBe(true);
    expect(await getMessages(id)).toHaveLength(1);
  });

  it("remembers the tabs a conversation's runs drove, newest first", async () => {
    const first = await appendMessageFresh(msg("user", "check gmail"));
    expect(await threadTabs(first)).toEqual([]); // no run yet

    await recordDrivenTabFor(first, { url: "https://mail.google.com/", title: "Inbox", tabId: 7 });
    await recordDrivenTabFor(first, {
      url: "https://docs.google.com/d/1",
      title: "Q3 Invoice",
      tabId: 9,
    });
    expect((await threadTabs(first)).map((t) => t.url)).toEqual([
      "https://docs.google.com/d/1",
      "https://mail.google.com/",
    ]);

    // Re-driving a tab moves it back to the front instead of duplicating it.
    await recordDrivenTabFor(first, { url: "https://mail.google.com/", title: "Inbox", tabId: 7 });
    expect((await threadTabs(first)).map((t) => t.url)).toEqual([
      "https://mail.google.com/",
      "https://docs.google.com/d/1",
    ]);

    // Later appends rewrite the index row without dropping the list.
    await appendMessageTo(first, msg("assistant", "done"));
    expect(await threadTabs(first)).toHaveLength(2);

    // Tabs belong to their own conversation — a second thread starts clean.
    const second = await appendMessageFresh(msg("user", "unrelated task"));
    expect(await threadTabs(second)).toEqual([]);
    expect(await threadTabs(first)).toHaveLength(2);
  });

  it("keeps the record when the run's closing writes land in the same tick", async () => {
    // How a run actually ends: the transcript writer fires its closing append
    // fire-and-forget and start-run records the driven tab right behind it.
    // Both rewrite the index row, so an unserialized record loses the whole
    // list to theirs — and a thread that forgets its strip mints a new one on
    // every follow-up.
    const id = await appendMessageFresh(msg("user", "book a flight"));
    void appendMessageTo(id, msg("assistant", "booked"));
    await recordDrivenTabFor(id, { url: "https://air.test/", title: "Air", tabId: 4, groupId: 7 });
    await appendMessageTo(id, msg("assistant", "done"));

    expect(await threadTabs(id)).toEqual([
      { url: "https://air.test/", title: "Air", tabId: 4, groupId: 7 },
    ]);
  });

  it("remembers what the strip held, apart from the tab the run drove", async () => {
    // The strip's membership answers a different question than the driven-tab
    // list — "which group is this thread's" — and holds pages the run only
    // filed. Keeping it out of `tabs` keeps filed reference pages out of the
    // model's "earlier work" line and out of that list's tighter cap.
    const id = await appendMessageFresh(msg("user", "copy from the doc"));
    await recordDrivenTabFor(id, { url: "https://air.test/", title: "Air", tabId: 4, groupId: 7 }, [
      "https://air.test/",
      "https://docs.test/spec",
    ]);

    expect((await getThreadTabsFor(id)).stripUrls).toEqual([
      "https://air.test/",
      "https://docs.test/spec",
    ]);
    expect(await threadTabs(id)).toHaveLength(1);
  });

  it("a run with no strip leaves the thread's last known one standing", async () => {
    // A read-only run groups nothing, so it has no membership to report —
    // erasing the record would cost the thread the only key that survives a
    // restart, and the next run would mint a second strip beside the first.
    const id = await appendMessageFresh(msg("user", "check the page"));
    await recordDrivenTabFor(id, { url: "https://air.test/", title: "Air", groupId: 7 }, [
      "https://air.test/",
      "https://docs.test/spec",
    ]);
    await recordDrivenTabFor(id, { url: "https://news.test/", title: "News" });

    expect((await getThreadTabsFor(id)).stripUrls).toEqual([
      "https://air.test/",
      "https://docs.test/spec",
    ]);
  });

  it("caps the strip snapshot too — a big working set stays bounded", async () => {
    const id = await appendMessageFresh(msg("user", "many tabs"));
    const urls = Array.from({ length: 14 }, (_, i) => `https://filed${i}.test/`);
    await recordDrivenTabFor(id, { url: urls[0] ?? "", title: "First" }, urls);
    expect((await getThreadTabsFor(id)).stripUrls).toHaveLength(10);
  });

  it("caps the tab list so a long multi-tab session stays bounded", async () => {
    const id = await appendMessageFresh(msg("user", "many tabs"));
    for (let i = 0; i < 8; i++) {
      await recordDrivenTabFor(id, { url: `https://site${i}.com/`, title: `Site ${i}` });
    }
    const tabs = await threadTabs(id);
    expect(tabs).toHaveLength(5);
    expect(tabs[0]?.url).toBe("https://site7.com/"); // newest work first
    expect(tabs.map((t) => t.url)).not.toContain("https://site2.com/"); // oldest evicted
  });
});
