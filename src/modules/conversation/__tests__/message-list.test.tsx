import { beforeAll, describe, expect, it } from "vitest";

// Regression check for the jump-to-latest pill. The shadcn scroller's
// `scrollable.end` means "unseen content below the viewport" (the old
// !stuck), so the pill must be ABSENT while following the live edge and
// PRESENT once the reader scrolls away. The adoption initially mapped it
// onto the old `stuck` and rendered on !stuck — the pill showed forever
// exactly at the bottom. jsdom has no layout: the scrolled-away half stubs
// viewport/item metrics, the following half needs none.

import { act } from "react";
import { createRoot } from "react-dom/client";
import type { Root } from "react-dom/client";
import { setI18n } from "react-i18next";
import { i18n } from "@/i18n";
import type { Message } from "../types";
import { MessageList } from "../ui/MessageList";
import { useConversationStore } from "../ui/store";

// react-dom/client act opt-in (no testing-library in this repo).
(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

// jsdom has no element scrollTo; the scroller primitive uses it for every
// programmatic jump, so without this the jumps (and the regression below)
// would never materialize. Covers both overload forms — (options) and (x, y).
Element.prototype.scrollTo = function (
  this: Element,
  optsOrX?: ScrollToOptions | number,
  y?: number,
) {
  this.scrollTop = typeof optsOrX === "number" ? (y ?? 0) : (optsOrX?.top ?? 0);
};

// test-setup inits the shared instance but never registers it with
// react-i18next; without this useTranslation finds no instance.
beforeAll(() => setI18n(i18n));

const MESSAGES: Message[] = [
  { id: "u1", role: "user", content: "Summarize the page", timestamp: 0 },
  { id: "a1", role: "assistant", content: "Done.", timestamp: 1 },
];

const PILL = "Jump to latest ↓";

async function renderList(): Promise<{ container: HTMLElement; root: Root }> {
  useConversationStore.setState({
    messages: MESSAGES,
    status: "idle",
    streamingText: "",
    reasoningText: "",
  });
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => root.render(<MessageList />));
  return { container, root };
}

async function unmount({ container, root }: { container: HTMLElement; root: Root }) {
  await act(async () => root.unmount());
  container.remove();
}

const pill = (container: HTMLElement) =>
  [...container.querySelectorAll("button")].find((b) => b.textContent === PILL);

/** jsdom has no layout: give the viewport a 200px window over 1000px of rows. */
function stubTallTranscript(container: HTMLElement): HTMLElement {
  const viewport = container.querySelector<HTMLElement>('[data-slot="message-scroller-viewport"]')!;
  Object.defineProperty(viewport, "clientHeight", { configurable: true, value: 200 });
  viewport.getBoundingClientRect = () => new DOMRect(0, 0, 300, 200);
  for (const item of container.querySelectorAll<HTMLElement>(
    '[data-slot="message-scroller-item"]',
  )) {
    item.getBoundingClientRect = () => new DOMRect(0, 0, 300, 1000);
  }
  return viewport;
}

describe("MessageList jump pill", () => {
  it("is hidden while the reader follows the live edge", async () => {
    const view = await renderList();
    expect(pill(view.container)).toBeUndefined();
    await unmount(view);
  });

  it("appears once the reader scrolls away, and clicking it returns to the edge", async () => {
    const view = await renderList();
    const viewport = stubTallTranscript(view.container);
    // The wheel marks user scroll intent (following → free-scrolling); the
    // scroll commit then measures the stubbed geometry — 800px of rows below
    // the window, past the 80px stick threshold.
    await act(async () => {
      viewport.dispatchEvent(new WheelEvent("wheel", { deltaY: 100, bubbles: true }));
      viewport.dispatchEvent(new Event("scroll"));
    });
    const button = pill(view.container);
    expect(button).toBeDefined();
    // Clicking jumps to the end and re-engages following — the pill clears.
    await act(async () => button!.click());
    expect(pill(view.container)).toBeUndefined();
    await unmount(view);
  });
});

/**
 * Scroll-aware layout: the viewport is a 200px window over `rows` 100px rows,
 * and item rects track scrollTop so the primitive's document-space math holds.
 */
function stubScrollLayout(container: HTMLElement, rows: number): HTMLElement {
  const viewport = container.querySelector<HTMLElement>('[data-slot="message-scroller-viewport"]')!;
  Object.defineProperty(viewport, "clientHeight", { configurable: true, value: 200 });
  Object.defineProperty(viewport, "scrollHeight", { configurable: true, value: rows * 100 });
  viewport.getBoundingClientRect = () => new DOMRect(0, 0, 300, 200);
  [...container.querySelectorAll<HTMLElement>('[data-slot="message-scroller-item"]')].forEach(
    (item, i) => {
      item.getBoundingClientRect = () => {
        const top = i * 100 - viewport.scrollTop;
        return new DOMRect(0, top, 300, 100);
      };
    },
  );
  return viewport;
}

describe("transcript scroll on settle", () => {
  // Regression for shadcn-ui/ui#11128 (fixed upstream post-0.3.0, carried as a
  // bun patch): mount-time anchors never enter the handled set, so a
  // same-count swap — the working dots replaced by the error bubble — took
  // the "count unchanged" branch and yanked the reader to the oldest anchor.
  const SEED: Message[] = [
    { id: "u1", role: "user", content: "first task", timestamp: 0 },
    { id: "a1", role: "assistant", content: "first reply", timestamp: 1 },
    { id: "u2", role: "user", content: "second task", timestamp: 2 },
  ];

  it("a same-count settle swap keeps the reader at the live edge", async () => {
    // Running: three messages + the working-dots row = four items.
    useConversationStore.setState({ messages: SEED, status: "running" });
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    await act(async () => root.render(<MessageList />));
    const viewport = stubScrollLayout(container, 4);
    // Commit the stubbed geometry so following-bottom holds at the bottom.
    await act(async () => {
      viewport.scrollTop = 200;
      viewport.dispatchEvent(new Event("scroll"));
    });
    expect(viewport.scrollTop).toBe(200);

    // The run dies: the dots row is replaced by the error bubble — four items
    // in, four items out, so the scroller takes its "count unchanged" branch.
    await act(async () => {
      useConversationStore.setState({
        messages: [...SEED, { id: "e1", role: "error", content: "boom", timestamp: 4 }],
        status: "error",
        streamingText: "",
        reasoningText: "",
      });
      await new Promise((r) => setTimeout(r));
    });

    expect(viewport.scrollTop).toBe(200);
    await act(async () => root.unmount());
    container.remove();
  });
});
