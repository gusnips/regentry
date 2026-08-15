import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// The composer's two behaviors: the morph button (one slot — ↑ Send/Queue
// whenever there's text, ■ Stop only while steering with an empty input) and
// the run-target control, which is a two-state preference while idle and
// becomes the walk-away action ("Run in background") while a run of this
// panel's own is live. Plus the run band's plan peek, which unfolds the steps
// it had to hide. Same createRoot+act seam as chat-input-slash.test.tsx.

import { act } from "react";
import { createRoot } from "react-dom/client";
import type { Root } from "react-dom/client";
import { setI18n } from "react-i18next";
import { i18n } from "@/i18n";
import { ChatInput } from "../ui/ChatInput";
import { RunTargetToggle } from "../ui/RunTargetToggle";
import { RunStatus } from "../ui/RunStatus";
import { useConversationStore } from "../ui/store";

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

beforeAll(() => setI18n(i18n));

interface Harness {
  container: HTMLElement;
  root: Root;
}

async function render(ui: React.ReactElement): Promise<Harness> {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => root.render(ui));
  return { container, root };
}

async function unmount({ container, root }: Harness) {
  await act(async () => root.unmount());
  container.remove();
}

async function click(el: Element) {
  await act(async () => {
    el.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
}

const morphButton = (h: Harness, label: string) =>
  h.container.querySelector(`button[aria-label="${label}"]`);

beforeEach(() => {
  useConversationStore.setState({
    messages: [],
    conversations: [],
    activeId: null,
    draft: "",
    pastedTexts: [],
    collapseDisabled: false,
    runTarget: "thisPage",
    status: "idle",
    usage: { input: 0, output: 0 },
    runStartedAt: null,
    runEndedAt: null,
    planApproval: null,
    planApproved: false,
    queued: [],
    queuedRun: null,
    board: { queue: [] },
    drivingTab: null,
    bridgeActive: null,
  });
});

afterEach(() => vi.restoreAllMocks());

describe("morph button", () => {
  it("is a disabled Send when idle with an empty input", async () => {
    const h = await render(<ChatInput />);
    const send = morphButton(h, "Send");
    expect(send).not.toBeNull();
    expect((send as HTMLButtonElement).disabled).toBe(true);
    expect(morphButton(h, "Stop")).toBeNull();
    await unmount(h);
  });

  it("is Stop while steering with an empty input, Queue once there's text", async () => {
    useConversationStore.setState({ status: "running", runStartedAt: Date.now() });
    const h = await render(<ChatInput />);
    expect(morphButton(h, "Stop")).not.toBeNull();
    expect(morphButton(h, "Send")).toBeNull();

    await act(async () => useConversationStore.getState().setDraft("keep going"));
    expect(morphButton(h, "Queue")).not.toBeNull();
    expect(morphButton(h, "Stop")).toBeNull();
    await unmount(h);
  });

  it("never stops while our own run only waits in the queue", async () => {
    useConversationStore.setState({
      queuedRun: { id: "q1", position: 1, task: "next thing" },
      board: {
        queue: [
          { id: "q1", conversationId: "c1", owner: "panel", task: "next thing", enqueuedAt: 1 },
        ],
      },
    });
    const h = await render(<ChatInput />);
    expect(morphButton(h, "Stop")).toBeNull();
    expect(morphButton(h, "Send")).not.toBeNull();
    await unmount(h);
  });
});

describe("run target: a preference while idle, the walk-away while running", () => {
  const toggleButton = (h: Harness) => {
    const btn = h.container.querySelector("button");
    if (!btn) throw new Error("no toggle");
    return btn;
  };

  it("idle with an old plan card: the flip is only a preference", async () => {
    useConversationStore.setState({
      messages: [{ id: "m1", role: "plan", content: "", steps: ["a"], timestamp: 1000 }],
    });
    const close = vi.spyOn(window, "close").mockImplementation(() => {});
    const h = await render(<RunTargetToggle />);
    expect(toggleButton(h).textContent).toBe("This page");
    await click(toggleButton(h));
    expect(useConversationStore.getState().runTarget).toBe("background");
    expect(close).not.toHaveBeenCalled();
    await unmount(h);
  });

  it("live run past the plan gate: the control is the walk-away action", async () => {
    useConversationStore.setState({
      status: "running",
      runStartedAt: Date.now(),
      planApproved: true,
    });
    const close = vi.spyOn(window, "close").mockImplementation(() => {});
    const h = await render(<RunTargetToggle />);
    expect(toggleButton(h).textContent).toBe("Run in background");
    await click(toggleButton(h));
    expect(close).toHaveBeenCalledTimes(1);
    // An act on the run in flight, not a vote on where the next one goes.
    expect(useConversationStore.getState().runTarget).toBe("thisPage");
    await unmount(h);
  });

  it("parked on the plan approval: the action is there but cannot strand the gate", async () => {
    useConversationStore.setState({
      status: "running",
      runStartedAt: Date.now(),
      planApproval: { steps: ["a"], reapproval: false },
    });
    const close = vi.spyOn(window, "close").mockImplementation(() => {});
    const h = await render(<RunTargetToggle />);
    expect(toggleButton(h).disabled).toBe(true);
    await click(toggleButton(h));
    expect(close).not.toHaveBeenCalled();
    await unmount(h);
  });
});

describe("the run band's plan peek", () => {
  const PLAN = ["find the listing", "open it", "read the price", "check stock", "report back"];
  // The finished band: a stored last-run summary plus the run's plan card.
  const settled = () => {
    useConversationStore.setState({
      status: "idle",
      activeId: "c1",
      conversations: [
        {
          id: "c1",
          title: "t",
          createdAt: 0,
          updatedAt: 0,
          messageCount: 1,
          lastRun: { startedAt: 0, endedAt: 1000, input: 1, output: 1, ok: true },
        },
      ],
      messages: [{ id: "p1", role: "plan", content: "", steps: PLAN, current: 5, timestamp: 1 }],
    });
  };
  const peek = (h: Harness) =>
    [...h.container.querySelectorAll("button")].find((b) => b.hasAttribute("aria-expanded"));

  it("unfolds the steps it hid, and folds them back", async () => {
    settled();
    const h = await render(<RunStatus />);
    const button = peek(h);
    expect(button).toBeDefined();
    // Collapsed: the window ends at the last step, the earlier ones are counts.
    expect(button!.textContent).not.toContain("find the listing");
    expect(button!.textContent).toContain("5 done · 0 to go");

    await click(button!);
    expect(peek(h)!.textContent).toContain("find the listing");
    await click(peek(h)!);
    expect(peek(h)!.textContent).not.toContain("find the listing");
    await unmount(h);
  });

  it("promises no expansion when the whole plan already fits", async () => {
    settled();
    useConversationStore.setState({
      messages: [
        { id: "p1", role: "plan", content: "", steps: ["one", "two"], current: 1, timestamp: 1 },
      ],
    });
    const h = await render(<RunStatus />);
    expect(peek(h)).toBeUndefined();
    await unmount(h);
  });
});
