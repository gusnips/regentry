import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  paintIndicator,
  removeIndicator,
  stepFaviconFrame,
  waitIndicator,
  showAgentIndicator,
  refreshAgentIndicator,
  hideAgentIndicator,
  waitAgentIndicator,
  clearAgentWait,
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

function paint() {
  paintIndicator(ARGS.hostId, "TabRunner is driving", ARGS.linkId, ARGS.dot, ARGS.restoreId);
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

describe("waiting state", () => {
  const WAITING_URL = "data:image/svg+xml,question";

  beforeEach(() => {
    document.head.innerHTML = "";
    document.body.innerHTML = "";
  });

  it("removes the badge and sets the waiting favicon", () => {
    paint();
    waitIndicator(ARGS.hostId, ARGS.linkId, WAITING_URL);

    expect(document.getElementById(ARGS.hostId)).toBeNull();
    const links = iconLinks();
    expect(links).toHaveLength(1);
    expect(links[0]?.href).toBe(WAITING_URL);
  });

  it("creates the link when none existed yet", () => {
    waitIndicator(ARGS.hostId, ARGS.linkId, WAITING_URL);

    const links = iconLinks();
    expect(links).toHaveLength(1);
    expect(links[0]?.id).toBe(ARGS.linkId);
    expect(links[0]?.href).toBe(WAITING_URL);
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
    await showAgentIndicator(1, "TabRunner is driving");
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
    await showAgentIndicator(9, "TabRunner is driving");
    await vi.advanceTimersByTimeAsync(2800);
    expect(frameBeats()).toHaveLength(0);

    // Navigating onto a page that does accept them picks the heartbeat back up.
    executeScript.mockResolvedValue([]);
    await refreshAgentIndicator(9);
    await vi.advanceTimersByTimeAsync(700);
    expect(frameBeats()).toHaveLength(1);
    await hideAgentIndicator(9);
  });

  it("wait marks the strip without a pulse, and clear removes the mark", async () => {
    await waitAgentIndicator(2);
    // No pulse beats, ever — the wait is a still state.
    await vi.advanceTimersByTimeAsync(2800);
    expect(frameBeats()).toHaveLength(0);
    // One injection, carrying waitIndicator + waiting URL.
    const waits = executeScript.mock.calls.filter(
      (c) => (c[0] as { func: unknown }).func === waitIndicator,
    );
    expect(waits).toHaveLength(1);

    // clear in a new run calls hideAgentIndicator → removeIndicator.
    await clearAgentWait();
    const removes = executeScript.mock.calls.filter(
      (c) => (c[0] as { func: unknown }).func === removeIndicator,
    );
    expect(removes).toHaveLength(1);
  });

  it("show drives again on a waiting tab — wait is cleared, paint and restore follow", async () => {
    await waitAgentIndicator(3);

    await showAgentIndicator(3, "TabRunner is driving");
    // showAgentIndicator calls paintIndicator, never waitIndicator or removeIndicator.
    const paints = executeScript.mock.calls.filter(
      (c) => (c[0] as { func: unknown }).func === paintIndicator,
    );
    expect(paints).toHaveLength(1);
    // hide runs normally once — no wait-specific cleanup, since show already cleared it.
    await hideAgentIndicator(3);
    const removes = executeScript.mock.calls.filter(
      (c) => (c[0] as { func: unknown }).func === removeIndicator,
    );
    expect(removes).toHaveLength(1);
  });
});
