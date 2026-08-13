import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  paintIndicator,
  removeIndicator,
  setMarksInert,
  stepFaviconFrame,
  showAgentIndicator,
  refreshAgentIndicator,
  hideAgentIndicator,
  waitAgentIndicator,
  clearAgentWait,
  withMarksClickThrough,
} from "../indicator";

// The page-side halves of the indicator, run directly in jsdom the way
// snapshot-script is tested — the chrome.scripting wrapper is a thin try/catch.

const ARGS = {
  hostId: "tabrunner-agent-indicator",
  linkId: "tabrunner-agent-favicon",
  restoreId: "tabrunner-agent-favicon-restore",
  dot: "data:image/svg+xml,dot",
};

function iconLinks(): HTMLLinkElement[] {
  return [...document.querySelectorAll<HTMLLinkElement>('link[rel~="icon"]')];
}

function paint(waiting = false, favicon = ARGS.dot) {
  paintIndicator(
    ARGS.hostId,
    waiting ? "TabRunner is waiting for you" : "TabRunner is driving",
    "Open the TabRunner panel",
    ARGS.linkId,
    favicon,
    ARGS.restoreId,
    waiting,
  );
}

function remove() {
  removeIndicator(ARGS.hostId, ARGS.linkId, ARGS.restoreId);
}

describe("indicator page marks", () => {
  beforeEach(() => {
    document.head.innerHTML = "";
    document.body.innerHTML = "";
  });

  it("appends the dot after the page's own icons so it wins the strip", () => {
    document.head.innerHTML = '<link rel="icon" href="/page-icon.png">';
    paint();

    const links = iconLinks();
    expect(links).toHaveLength(2);
    expect(links[links.length - 1]?.href).toBe(ARGS.dot); // last link wins in Chrome
    expect(document.getElementById(ARGS.hostId)).not.toBeNull();
  });

  it("painting twice leaves one badge and one dot, not a pile", () => {
    paint();
    paint();
    expect(iconLinks()).toHaveLength(1);
    expect(document.querySelectorAll(`#${ARGS.hostId}`)).toHaveLength(1);
  });

  it("hands the favicon back to the page's own icon on remove", () => {
    document.head.innerHTML =
      '<link rel="icon" href="/old.png"><link rel="icon" href="/current.png">';
    paint();
    remove();

    // The page's own links stay untouched; a trailing restore link re-asserts
    // the one Chrome was showing — removal alone doesn't make Chrome re-resolve.
    const links = iconLinks();
    const restore = links[links.length - 1];
    expect(links).toHaveLength(3);
    expect(restore?.id).toBe(ARGS.restoreId);
    expect(restore?.href.endsWith("/current.png")).toBe(true);
    expect(document.getElementById(ARGS.hostId)).toBeNull();
  });

  it("falls back to the root favicon.ico when the page declared no icon", () => {
    paint();
    remove();

    const links = iconLinks();
    expect(links).toHaveLength(1);
    expect(links[0]?.href.endsWith("/favicon.ico")).toBe(true);
  });

  it("a new paint clears the restore link before dotting again", () => {
    paint();
    remove();
    paint();
    expect(iconLinks()).toHaveLength(1);
    expect(iconLinks()[0]?.href).toBe(ARGS.dot);
  });

  it("holds the full frame under prefers-reduced-motion", () => {
    document.head.innerHTML = "";
    const link = document.createElement("link");
    link.id = ARGS.linkId;
    link.rel = "icon";
    link.href = ARGS.dot;
    document.head.appendChild(link);
    // jsdom never matches media features — stub the query itself.
    const original = window.matchMedia;
    window.matchMedia = ((query: string) => ({
      matches: true,
      media: query,
    })) as unknown as typeof window.matchMedia;
    try {
      stepFaviconFrame(ARGS.linkId, "data:image/svg+xml,dim");
      expect(link.href).toBe(ARGS.dot);
    } finally {
      window.matchMedia = original;
    }
  });
});

describe("the badge as a control", () => {
  const WAITING_URL = "data:image/svg+xml,question";
  const original = Element.prototype.attachShadow;
  const chromeBackup = globalThis.chrome;

  beforeEach(() => {
    document.head.innerHTML = "";
    document.body.innerHTML = "";
    // Closed in production so the page can't reach in; forced open to assert.
    Element.prototype.attachShadow = function () {
      return original.call(this, { mode: "open" });
    };
  });

  afterEach(() => {
    Element.prototype.attachShadow = original;
    (globalThis as Record<string, unknown>).chrome = chromeBackup;
  });

  const badge = () =>
    document.getElementById(ARGS.hostId)!.shadowRoot!.querySelector<HTMLElement>(".badge")!;

  it("keeps the badge through a wait, swapping the pulse for the still ?", () => {
    paint(true, WAITING_URL);

    // The mark never leaves the page mid-run: a parked run is when the user is
    // needed most, so the badge says so instead of vanishing.
    expect(badge().textContent).toContain("waiting");
    expect(badge().querySelector(".wait")?.textContent).toBe("?");
    expect(badge().querySelector(".dot")).toBeNull();
    const links = iconLinks();
    expect(links).toHaveLength(1);
    expect(links[0]?.href).toBe(WAITING_URL);
  });

  it("clicking it asks the worker for the panel", () => {
    const sendMessage = vi.fn();
    (globalThis as Record<string, unknown>).chrome = { ...chromeBackup, runtime: { sendMessage } };
    paint();
    badge().click();
    expect(sendMessage).toHaveBeenCalledWith({ type: "tabrunner-mark", action: "open" });
  });

  it("goes click-through while the agent clicks, so it can't eat its own click", () => {
    paint();
    const host = document.getElementById(ARGS.hostId)!;
    setMarksInert([ARGS.hostId], true);
    expect(host.dataset.inert).toBe("1");
    setMarksInert([ARGS.hostId], false);
    expect(host.dataset.inert).toBeUndefined();
  });
});

describe("worker-driven favicon heartbeat", () => {
  // The pulse lives in the worker because Chrome throttles hidden-tab timers
  // into silence — hidden is exactly when the strip signal matters.
  let executeScript: ReturnType<typeof vi.fn>;
  const chromeBackup = globalThis.chrome;

  beforeEach(() => {
    vi.useFakeTimers();
    executeScript = vi.fn().mockResolvedValue([]);
    (globalThis as Record<string, unknown>).chrome = {
      ...chromeBackup,
      scripting: { executeScript },
    };
  });

  afterEach(() => {
    vi.useRealTimers();
    (globalThis as Record<string, unknown>).chrome = chromeBackup;
  });

  const frameBeats = () =>
    executeScript.mock.calls.filter((c) => (c[0] as { func: unknown }).func === stepFaviconFrame);

  it("alternates two frames every beat while shown, and stops on hide", async () => {
    await showAgentIndicator(1);
    expect(frameBeats()).toHaveLength(0);

    await vi.advanceTimersByTimeAsync(700);
    await vi.advanceTimersByTimeAsync(700);
    const frames = frameBeats().map((c) => (c[0] as { args: string[] }).args[1]);
    expect(frames).toHaveLength(2);
    expect(frames[0]).not.toBe(frames[1]); // full ↔ dim, one motion language

    await hideAgentIndicator(1);
    await vi.advanceTimersByTimeAsync(2800);
    expect(frameBeats()).toHaveLength(2); // no beats after hide
  });

  it("never beats on a page that refused the paint", async () => {
    // A PDF viewer, a file:// url without file access, a hostile CSP. The
    // heartbeat would fire an executeScript every 700ms forever, drawing
    // nothing — the tab group and the toolbar badge carry the signal there.
    executeScript.mockRejectedValue(new Error("Cannot access contents of the page"));
    await showAgentIndicator(9);
    await vi.advanceTimersByTimeAsync(2800);
    expect(frameBeats()).toHaveLength(0);

    // Navigating onto a page that does accept them picks the heartbeat back up.
    executeScript.mockResolvedValue([]);
    await refreshAgentIndicator(9);
    await vi.advanceTimersByTimeAsync(700);
    expect(frameBeats()).toHaveLength(1);
    await hideAgentIndicator(9);
  });

  const paintCalls = () =>
    executeScript.mock.calls.filter((c) => (c[0] as { func: unknown }).func === paintIndicator);

  it("wait marks the strip without a pulse, and clear removes the mark", async () => {
    await waitAgentIndicator(2);
    // No pulse beats, ever — the wait is a still state.
    await vi.advanceTimersByTimeAsync(2800);
    expect(frameBeats()).toHaveLength(0);
    // One paint, in the waiting state — the badge stays, saying it needs you.
    expect(paintCalls()).toHaveLength(1);
    expect((paintCalls()[0]?.[0] as { args: unknown[] }).args.at(-1)).toBe(true);

    // A repaint after a navigation lands the same waiting state, not "driving".
    await refreshAgentIndicator(2);
    expect((paintCalls()[1]?.[0] as { args: unknown[] }).args.at(-1)).toBe(true);

    // clear in a new run calls hideAgentIndicator → removeIndicator.
    await clearAgentWait();
    const removes = executeScript.mock.calls.filter(
      (c) => (c[0] as { func: unknown }).func === removeIndicator,
    );
    expect(removes).toHaveLength(1);
  });

  it("hands the corner back around an agent click, then takes it again", async () => {
    const clicked = await withMarksClickThrough(4, () => Promise.resolve("done"));
    expect(clicked).toBe("done");
    const toggles = executeScript.mock.calls
      .filter((c) => (c[0] as { func: unknown }).func === setMarksInert)
      .map((c) => (c[0] as { args: unknown[] }).args[1]);
    expect(toggles).toEqual([true, false]);
  });

  it("restores the marks even when the click throws", async () => {
    await expect(
      withMarksClickThrough(5, () => Promise.reject(new Error("target gone"))),
    ).rejects.toThrow("target gone");
    const toggles = executeScript.mock.calls
      .filter((c) => (c[0] as { func: unknown }).func === setMarksInert)
      .map((c) => (c[0] as { args: unknown[] }).args[1]);
    expect(toggles).toEqual([true, false]);
  });

  it("show drives again on a waiting tab — wait is cleared, paint and restore follow", async () => {
    await waitAgentIndicator(3);

    await showAgentIndicator(3);
    // Both states paint the same badge; only the last argument differs, and an
    // approved plan puts the run back to work — waiting first, driving second.
    expect(paintCalls().map((c) => (c[0] as { args: unknown[] }).args.at(-1))).toEqual([
      true,
      false,
    ]);
    // hide runs normally once — no wait-specific cleanup, since show already cleared it.
    await hideAgentIndicator(3);
    const removes = executeScript.mock.calls.filter(
      (c) => (c[0] as { func: unknown }).func === removeIndicator,
    );
    expect(removes).toHaveLength(1);
  });
});
