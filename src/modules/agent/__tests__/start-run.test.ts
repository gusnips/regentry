import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createRunGroup, labelRunTab, liveThreadGroup, settleRunTab } from "../start-run";
import type { LastTab } from "@/modules/conversation/conversations";

// One thread, one strip: follow-up messages file their tab under the group the
// thread already has — until the user closes that strip away, after which the
// next run starts a fresh one.

const recorded = (tabId: number, groupId?: number): LastTab => ({
  url: `https://example.com/${tabId}`,
  title: `tab ${tabId}`,
  tabId,
  ...(groupId !== undefined ? { groupId } : {}),
});

describe("thread tab group", () => {
  const chromeBackup = globalThis.chrome;
  let tabsGet: ReturnType<typeof vi.fn>;
  let tabsGroup: ReturnType<typeof vi.fn>;
  let groupGet: ReturnType<typeof vi.fn>;
  let groupUpdate: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    tabsGet = vi.fn();
    tabsGroup = vi.fn();
    groupGet = vi.fn();
    groupUpdate = vi.fn().mockResolvedValue(undefined);
    (globalThis as Record<string, unknown>).chrome = {
      ...chromeBackup,
      tabs: { ...chromeBackup.tabs, get: tabsGet, group: tabsGroup },
      tabGroups: { get: groupGet, update: groupUpdate },
    };
  });

  afterEach(() => {
    (globalThis as Record<string, unknown>).chrome = chromeBackup;
  });

  describe("liveThreadGroup", () => {
    it("is undefined without a recorded group", async () => {
      expect(await liveThreadGroup([])).toBeUndefined();
      // Bare urls with no group recorded.
      expect(await liveThreadGroup([recorded(1), recorded(2)])).toBeUndefined();
      expect(groupGet).not.toHaveBeenCalled();
    });

    it("is the newest recorded group that is still alive", async () => {
      groupGet.mockResolvedValue({ title: "book the flight" });
      const tabs = [recorded(1, 7), recorded(2, 9)];
      expect(await liveThreadGroup(tabs)).toBe(7);
      // Newest first: the older record is never even checked.
      expect(groupGet).toHaveBeenCalledTimes(1);
      expect(groupGet).toHaveBeenCalledWith(7);
    });

    it("outlives the tab that earned the record — strips outlive their tabs", async () => {
      // The driven tab was closed once the task ended; the strip of group_tab'd
      // tabs lives on. A live recorded group IS the thread's — minting a second
      // one alongside it is the bug this fixes. No tab lookup is even made.
      groupGet.mockResolvedValue({ title: "book the flight" });
      expect(await liveThreadGroup([recorded(1, 7)])).toBe(7);
      expect(tabsGet).not.toHaveBeenCalled();
    });

    it("skips dead groups, dedupes records, and falls to older ones", async () => {
      groupGet
        .mockRejectedValueOnce(new Error("No group with id: 7"))
        .mockResolvedValueOnce({ title: "older strip" });
      const tabs = [recorded(1, 7), recorded(2, 7), recorded(3, 9)];
      expect(await liveThreadGroup(tabs)).toBe(9);
      expect(groupGet).toHaveBeenCalledTimes(2); // 7 checked once, then 9
    });

    it("is undefined when every recorded group is gone", async () => {
      groupGet.mockRejectedValue(new Error("No group"));
      expect(await liveThreadGroup([recorded(1, 7), recorded(2, 9)])).toBeUndefined();
    });

    // A chrome.tabs.Tab needs a dozen fields the shortcut never reads.
    const tabOn = (url: string, groupId: number) =>
      ({ url, groupId }) as unknown as chrome.tabs.Tab;

    it("keeps the group the tab in hand already sits in when the thread drove its url", async () => {
      // The records are all stale (closed tabs, a browser restart) — the tab
      // itself is the proof: the conversation drove this url, and it still
      // sits grouped. Minting a second group around it is the bug this fixes.
      groupGet.mockRejectedValue(new Error("No group with id"));
      const tabs = [recorded(1, 7)];
      const onIt = tabOn("https://example.com/1", 4);
      expect(await liveThreadGroup(tabs, onIt)).toBe(4);
      expect(groupGet).not.toHaveBeenCalled();
    });

    it("ignores the tab in hand's group when the thread never drove its url", async () => {
      // A url the conversation never touched, sitting in a group of the user's
      // own — that group is theirs, not the thread's. Fall to the records.
      groupGet.mockResolvedValue({ title: "book the flight" });
      const onIt = tabOn("https://unrelated.example", 4);
      expect(await liveThreadGroup([recorded(1, 7)], onIt)).toBe(7);
    });

    it("ignores an ungrouped tab in hand", async () => {
      groupGet.mockResolvedValue({ title: "book the flight" });
      const onIt = tabOn("https://example.com/1", -1);
      expect(await liveThreadGroup([recorded(1, 7)], onIt)).toBe(7);
    });
  });

  describe("labelRunTab", () => {
    it("mints a fresh group when the thread has none", async () => {
      tabsGroup.mockResolvedValue(7);
      expect(await labelRunTab(42, "book the flight")).toBe(7);
      expect(tabsGroup).toHaveBeenCalledWith({ tabIds: 42 });
      expect(groupUpdate).toHaveBeenCalledWith(7, {
        title: "book the flight",
        color: "green",
        collapsed: false,
      });
    });

    it("files the tab under the thread's live group", async () => {
      tabsGroup.mockResolvedValue(7);
      expect(await labelRunTab(42, "book the flight", 7)).toBe(7);
      expect(tabsGroup).toHaveBeenCalledWith({ tabIds: 42, groupId: 7 });
      expect(tabsGroup).toHaveBeenCalledTimes(1);
    });

    it("falls back to a fresh group when the thread's is gone", async () => {
      tabsGroup.mockRejectedValueOnce(new Error("No group with id: 7")).mockResolvedValue(8);
      expect(await labelRunTab(42, "book the flight", 7)).toBe(8);
      expect(tabsGroup).toHaveBeenLastCalledWith({ tabIds: 42 });
    });

    it("never fails a run over grouping", async () => {
      tabsGroup.mockRejectedValue(new Error("cannot group"));
      expect(await labelRunTab(42, "book the flight")).toBeUndefined();
      expect(groupUpdate).not.toHaveBeenCalled();
    });

    it("keeps the parked strip's name on a continuation, unmarking it", async () => {
      // The continuation's task is the answer fragment — the strip keeps naming
      // the task the question was about.
      tabsGroup.mockResolvedValue(7);
      groupGet.mockResolvedValue({ title: "? book the flight" });
      expect(await labelRunTab(42, "yes, the March one", 7, true)).toBe(7);
      expect(groupUpdate).toHaveBeenCalledWith(7, {
        title: "book the flight",
        color: "green",
        collapsed: false,
      });
    });

    it("names a freshly minted strip after the task even on a continuation", async () => {
      tabsGroup.mockResolvedValue(7);
      groupGet.mockResolvedValue({}); // a minted group carries no name
      expect(await labelRunTab(42, "yes, the March one", undefined, true)).toBe(7);
      expect(groupUpdate).toHaveBeenCalledWith(7, {
        title: "yes, the March one",
        color: "green",
        collapsed: false,
      });
    });
  });

  describe("settleRunTab", () => {
    it("re-marks the name the group already carries, not the task at hand", async () => {
      // A continuation's task is the user's answer fragment — the strip keeps
      // naming the task the question was about.
      groupGet.mockResolvedValue({ title: "book the flight" });
      await settleRunTab(7, "yes, the March one", "done");
      expect(groupUpdate).toHaveBeenCalledWith(7, {
        title: "✓ book the flight",
        collapsed: true,
      });
    });

    it("replaces the mark a previous run left", async () => {
      groupGet.mockResolvedValue({ title: "? book the flight" });
      await settleRunTab(7, "yes, the March one", "done");
      expect(groupUpdate).toHaveBeenCalledWith(7, {
        title: "✓ book the flight",
        collapsed: true,
      });
    });

    it("falls back to the task when the group carries no name", async () => {
      groupGet.mockResolvedValue({});
      await settleRunTab(7, "book the flight", "failed");
      expect(groupUpdate).toHaveBeenCalledWith(7, {
        title: "✗ book the flight",
        collapsed: true,
      });
    });

    it("never fails a run over a dead group", async () => {
      groupGet.mockRejectedValue(new Error("No group with id: 7"));
      await settleRunTab(7, "book the flight", "done");
      expect(groupUpdate).not.toHaveBeenCalled();
    });
  });

  describe("createRunGroup", () => {
    const runGroupFor = (over: Partial<Parameters<typeof createRunGroup>[0]> = {}) =>
      createRunGroup({
        task: "book the flight",
        keepName: false,
        mintOnTouch: true,
        drivenTabId: () => 42,
        ...over,
      });

    it("mints the strip around the driven tab on the first action", async () => {
      tabsGroup.mockResolvedValue(7);
      const rg = runGroupFor();
      expect(rg.groupId).toBeUndefined();
      await rg.touch();
      expect(tabsGroup).toHaveBeenCalledWith({ tabIds: 42 });
      expect(rg.groupId).toBe(7);
    });

    it("files later touches into the same strip", async () => {
      tabsGroup.mockResolvedValue(7);
      const driven = { id: 42 };
      const rg = runGroupFor({ drivenTabId: () => driven.id });
      await rg.touch();
      driven.id = 43; // the run switched tabs mid-flight
      await rg.touch();
      expect(tabsGroup).toHaveBeenLastCalledWith({ tabIds: 43, groupId: 7 });
    });

    it("joins the thread's seed strip when one was resolved", async () => {
      tabsGroup.mockResolvedValue(7);
      const rg = runGroupFor({ seedGroupId: 5 });
      await rg.touch();
      expect(tabsGroup).toHaveBeenCalledWith({ tabIds: 42, groupId: 5 });
    });

    it("never mints around a tab the user grouped while the question waited", async () => {
      const rg = runGroupFor({ keepName: true, mintOnTouch: false });
      tabsGet.mockResolvedValue({ groupId: 3 }); // a group of the user's own
      await rg.touch();
      expect(tabsGroup).not.toHaveBeenCalled();
      expect(rg.groupId).toBeUndefined();
    });

    it("mints for a continuation whose tab sits ungrouped", async () => {
      tabsGroup.mockResolvedValue(7);
      const rg = runGroupFor({ keepName: true, mintOnTouch: false });
      tabsGet.mockResolvedValue({ groupId: -1 });
      await rg.touch();
      expect(tabsGroup).toHaveBeenCalledWith({ tabIds: 42 });
    });

    it("stays silent when a later touch can't join — no second strip", async () => {
      tabsGroup.mockResolvedValueOnce(7).mockRejectedValue(new Error("different window"));
      const driven = { id: 42 };
      const rg = runGroupFor({ drivenTabId: () => driven.id });
      await rg.touch();
      driven.id = 43;
      await rg.touch(); // cross-window: no throw, no fresh mint
      expect(rg.groupId).toBe(7);
      expect(tabsGroup).toHaveBeenCalledTimes(2);
    });

    it("file mints the strip around the filed tab and returns its id", async () => {
      tabsGroup.mockResolvedValue(9);
      const rg = runGroupFor();
      await expect(rg.file(55)).resolves.toBe(9);
      expect(tabsGroup).toHaveBeenCalledWith({ tabIds: 55 });
    });
  });
});
