import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { paintWidget, removeWidget } from "../status-widget";

// The page-side half of the status widget, run directly in jsdom the way the
// indicator is tested. The widget's shadow root is closed in production so the
// page can't reach in; the test forces open roots to assert on the internals.

const HOST_ID = "tabrunner-status-widget";

function paint(awaiting = false) {
  paintWidget(HOST_ID, "Summarize the thread", "", "Open", "Hide", "Open hint", "Hide hint", "Expand hint", awaiting);
}

function host(): HTMLElement {
  const el = document.getElementById(HOST_ID);
  expect(el).not.toBeNull();
  return el as HTMLElement;
}

function parts() {
  const root = host().shadowRoot;
  expect(root).not.toBeNull();
  return {
    pill: root!.querySelector<HTMLElement>(".pill")!,
    mini: root!.querySelector<HTMLElement>(".mini")!,
    hide: [...root!.querySelectorAll<HTMLButtonElement>(".btn")].find(
      (b) => b.textContent === "Hide",
    )!,
  };
}

const visible = (el: HTMLElement) => el.style.display !== "none";

describe("status widget collapse", () => {
  const original = Element.prototype.attachShadow;

  beforeEach(() => {
    document.head.innerHTML = "";
    document.body.innerHTML = "";
    Element.prototype.attachShadow = function () {
      return original.call(this, { mode: "open" });
    };
  });

  afterEach(() => {
    Element.prototype.attachShadow = original;
  });

  it("starts expanded: pill visible, dot hidden", () => {
    paint();
    const { pill, mini } = parts();
    expect(visible(pill)).toBe(true);
    expect(visible(mini)).toBe(false);
    expect(host().dataset.collapsed).toBe("0");
  });

  it("hide collapses to the dot instead of removing the widget", () => {
    paint();
    const { pill, mini, hide } = parts();
    hide.click();

    expect(visible(pill)).toBe(false);
    expect(visible(mini)).toBe(true);
    expect(host().dataset.collapsed).toBe("1");
    // The working signal survives the collapse.
    expect(mini.querySelector(".dot")).not.toBeNull();
    expect(mini.title).toBe("Expand hint");
  });

  it("clicking the dot brings the pill back", () => {
    paint();
    const { pill, mini, hide } = parts();
    hide.click();
    mini.click();

    expect(visible(pill)).toBe(true);
    expect(visible(mini)).toBe(false);
    expect(host().dataset.collapsed).toBe("0");
  });

  it("a repaint keeps the collapsed state", () => {
    paint();
    parts().hide.click();
    paint(); // board content changed — the worker re-injects

    const { pill, mini } = parts();
    expect(visible(pill)).toBe(false);
    expect(visible(mini)).toBe(true);
  });

  it("a waiting run collapses to the still ?, never the pulse", () => {
    paint(true);
    parts().hide.click();

    const { mini } = parts();
    expect(mini.querySelector(".wait")?.textContent).toBe("?");
    expect(mini.querySelector(".dot")).toBeNull();
  });

  it("removeWidget still takes the whole thing down", () => {
    paint();
    removeWidget(HOST_ID);
    expect(document.getElementById(HOST_ID)).toBeNull();
  });

  it("open still messages the worker", () => {
    const sendMessage = vi.fn();
    const chromeBackup = globalThis.chrome;
    (globalThis as Record<string, unknown>).chrome = {
      ...chromeBackup,
      runtime: { sendMessage },
    };
    try {
      paint();
      const root = host().shadowRoot!;
      const open = [...root.querySelectorAll<HTMLButtonElement>(".btn")].find(
        (b) => b.textContent === "Open",
      )!;
      open.click();
      expect(sendMessage).toHaveBeenCalledWith({ type: "tabrunner-widget", action: "open" });
    } finally {
      (globalThis as Record<string, unknown>).chrome = chromeBackup;
    }
  });
});
