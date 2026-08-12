import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// The composer's two new behaviors: the morph button (one slot — ↑ Send/Queue
// whenever there's text, ■ Stop only while steering with an empty input) and
// the run-target toggle's live flip (mid-run "In background" closes the panel
// once the plan gate is past; idle or parked, it's only a preference). Same
// createRoot+act seam as chat-input-slash.test.tsx.

import { act } from "react";
import { createRoot } from "react-dom/client";
import type { Root } from "react-dom/client";
import { setI18n } from "react-i18next";
import { i18n } from "@/i18n";
import { ChatInput } from "../ui/ChatInput";
import { RunTargetToggle } from "../ui/RunTargetToggle";
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

describe("run-target toggle walk-away flip", () => {
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
    await click(toggleButton(h));
    expect(useConversationStore.getState().runTarget).toBe("background");
    expect(close).not.toHaveBeenCalled();
    await unmount(h);
  });

  it("live run past the plan gate: the flip closes the panel", async () => {
    useConversationStore.setState({
      status: "running",
      runStartedAt: Date.now(),
      planApproved: true,
    });
    const close = vi.spyOn(window, "close").mockImplementation(() => {});
    const h = await render(<RunTargetToggle />);
    await click(toggleButton(h));
    expect(useConversationStore.getState().runTarget).toBe("background");
    expect(close).toHaveBeenCalledTimes(1);
    await unmount(h);
  });

  it("parked on the plan approval: the flip cannot strand the gate", async () => {
    useConversationStore.setState({
      status: "running",
      runStartedAt: Date.now(),
      planApproval: { steps: ["a"], reapproval: false },
    });
    const close = vi.spyOn(window, "close").mockImplementation(() => {});
    const h = await render(<RunTargetToggle />);
    await click(toggleButton(h));
    expect(useConversationStore.getState().runTarget).toBe("background");
    expect(close).not.toHaveBeenCalled();
    await unmount(h);
  });
});
