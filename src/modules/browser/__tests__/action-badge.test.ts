import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { syncActionBadge } from "../action-badge";

// The badge is the one run signal that survives everything else failing, so
// what it says has to be right without a page to read it on.

describe("toolbar run badge", () => {
  let setBadgeText: ReturnType<typeof vi.fn>;
  const chromeBackup = globalThis.chrome;

  beforeEach(() => {
    setBadgeText = vi.fn().mockResolvedValue(undefined);
    (globalThis as Record<string, unknown>).chrome = {
      ...chromeBackup,
      action: {
        setBadgeText,
        setBadgeBackgroundColor: vi.fn().mockResolvedValue(undefined),
        setBadgeTextColor: vi.fn().mockResolvedValue(undefined),
      },
    };
  });

  afterEach(() => {
    (globalThis as Record<string, unknown>).chrome = chromeBackup;
  });

  const text = () => setBadgeText.mock.lastCall?.[0].text;

  it("counts the work, and clears when there is none", async () => {
    await syncActionBadge(0);
    expect(text()).toBe("");

    await syncActionBadge(1);
    expect(text()).toBe("1");

    // Running plus three waiting behind it — the number is the part no other
    // surface carries once the panel is closed.
    await syncActionBadge(4);
    expect(text()).toBe("4");
  });

  it("speaks the wait language when parked on the user", async () => {
    await syncActionBadge(2, true);
    expect(text()).toBe("?");
  });

  it("survives a browser with no toolbar to paint", async () => {
    setBadgeText.mockRejectedValue(new Error("no action"));
    await expect(syncActionBadge(1)).resolves.toBeUndefined();
  });
});
