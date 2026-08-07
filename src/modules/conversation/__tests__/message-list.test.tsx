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
  const viewport = container.querySelector<HTMLElement>(
    '[data-slot="message-scroller-viewport"]',
  )!;
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
