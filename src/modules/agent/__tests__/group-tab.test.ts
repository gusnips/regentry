import { describe, it, expect, vi } from "vitest";
import { executeTool } from "../tools";
import type { BrowserDriver } from "@/modules/browser";

// Storage stand-in and i18n come from src/test-setup.ts (vitest setupFiles).

// group_tab needs only the driver's grouping verb — everything else would
// pretend the tool touches the page, which it never does.
const driverWith = (groupTab: BrowserDriver["groupTab"]) =>
  ({ groupTab }) as unknown as BrowserDriver;

function groupTabCall(tabId: number) {
  return { id: "t1", name: "group_tab", args: { tab_id: tabId } };
}

describe("group_tab tool", () => {
  it("files the tab under the run's group", async () => {
    const groupTab = vi.fn(async (tabId: number) => ({
      id: tabId,
      windowId: 10,
      title: "Docs",
      url: "https://docs.example",
      active: false,
    }));
    const result = await executeTool(groupTabCall(2), driverWith(groupTab), { runGroupId: 7 });
    expect(groupTab).toHaveBeenCalledWith(2, 7);
    expect(result).toEqual({
      ok: true,
      data: { id: 2, windowId: 10, title: "Docs", url: "https://docs.example", active: false },
    });
  });

  it("refuses when the run has no group — direct control, or grouping was skipped", async () => {
    const groupTab = vi.fn();
    const result = await executeTool(groupTabCall(2), driverWith(groupTab));
    expect(result.ok).toBe(false);
    expect(result.error).toContain("no tab group");
    expect(groupTab).not.toHaveBeenCalled();
  });

  it("surfaces the driver's refusal as a tool error, not a crash", async () => {
    const groupTab = vi.fn(async () => {
      throw new Error("That tab is in another window");
    });
    const result = await executeTool(groupTabCall(2), driverWith(groupTab), { runGroupId: 7 });
    expect(result).toEqual({ ok: false, error: "That tab is in another window" });
  });
});
