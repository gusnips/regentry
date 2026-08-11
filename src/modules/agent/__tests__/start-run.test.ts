import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { labelRunTab, liveThreadGroup } from "../start-run";
import type { LastTab } from "@/modules/conversation/conversations";

// One thread, one strip: follow-up messages file their tab under the group the
// thread already has — until the user takes the group back (closes it, empties
// it, moves the tab out), after which the next run starts a fresh one.

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
  let groupUpdate: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    tabsGet = vi.fn();
    tabsGroup = vi.fn();
    groupUpdate = vi.fn().mockResolvedValue(undefined);
    (globalThis as Record<string, unknown>).chrome = {
      ...chromeBackup,
      tabs: { ...chromeBackup.tabs, get: tabsGet, group: tabsGroup },
      tabGroups: { update: groupUpdate },
    };
  });

  afterEach(() => {
    (globalThis as Record<string, unknown>).chrome = chromeBackup;
  });

  describe("liveThreadGroup", () => {
    it("is undefined without a usable record", async () => {
      expect(await liveThreadGroup([])).toBeUndefined();
      // No group recorded, and a bare url with neither tab nor group.
      expect(await liveThreadGroup([recorded(1), recorded(2)])).toBeUndefined();
      expect(tabsGet).not.toHaveBeenCalled();
    });

    it("is the newest recorded group whose tab still sits in it", async () => {
      tabsGet.mockResolvedValue({ groupId: 7 });
      const tabs = [recorded(1, 7), recorded(2, 9)];
      expect(await liveThreadGroup(tabs)).toBe(7);
      // Newest first: the older record is never even checked.
      expect(tabsGet).toHaveBeenCalledTimes(1);
      expect(tabsGet).toHaveBeenCalledWith(1);
    });

    it("skips records the user has taken back — dead tab, or tab moved out", async () => {
      tabsGet
        .mockRejectedValueOnce(new Error("no tab with id 1")) // died mid-question
        .mockResolvedValueOnce({ groupId: 5 }) // alive, but the user regrouped it
        .mockResolvedValueOnce({ groupId: 9 });
      const tabs = [recorded(1, 7), recorded(2, 7), recorded(3, 9)];
      expect(await liveThreadGroup(tabs)).toBe(9);
    });

    it("is undefined when every recorded group changed hands", async () => {
      tabsGet.mockResolvedValue({ groupId: 5 });
      expect(await liveThreadGroup([recorded(1, 7), recorded(2, 9)])).toBeUndefined();
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
  });
});
