import { describe, it, expect, beforeEach } from "vitest";
import { paintIndicator, removeIndicator } from "../indicator";

// The page-side halves of the indicator, run directly in jsdom the way
// snapshot-script is tested — the chrome.scripting wrapper is a thin try/catch.

const ARGS = {
  hostId: "regent-agent-indicator",
  linkId: "regent-agent-favicon",
  restoreId: "regent-agent-favicon-restore",
  dot: "data:image/svg+xml,dot",
};

function iconLinks(): HTMLLinkElement[] {
  return [...document.querySelectorAll<HTMLLinkElement>('link[rel~="icon"]')];
}

function paint() {
  paintIndicator(ARGS.hostId, "Regent is driving", ARGS.linkId, ARGS.dot, ARGS.restoreId);
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
});
