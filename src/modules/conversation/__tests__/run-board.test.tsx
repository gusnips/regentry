import { beforeAll, beforeEach, describe, expect, it } from "vitest";

// The run strip earns its space only by showing what the rest of the panel
// cannot: a run driving another conversation, or a task queued behind one. The
// open chat's own run has the live band, the composer's Stop and the message
// right above it, and our own queued submission has the composer's card — so
// both hide, and the strip disappears entirely in the one-chat-one-run case
// that made it read as a duplicate header row.

import { act } from "react";
import { createRoot } from "react-dom/client";
import type { Root } from "react-dom/client";
import { setI18n } from "react-i18next";
import { i18n } from "@/i18n";
import { RunBoard } from "../ui/RunBoard";
import { useConversationStore } from "../ui/store";

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

beforeAll(() => setI18n(i18n));

async function render() {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root: Root = createRoot(container);
  await act(async () => root.render(<RunBoard />));
  return { container, root };
}

const HERE = "conversation-here";
const ELSEWHERE = "conversation-elsewhere";

function queued(id: string, conversationId: string, task: string) {
  return { id, conversationId, owner: "panel" as const, task, enqueuedAt: 0 };
}

beforeEach(() => {
  useConversationStore.setState({
    activeId: HERE,
    board: { queue: [] },
    queuedRun: null,
  });
});

describe("run board", () => {
  it("says nothing about the run this chat is already showing", async () => {
    useConversationStore.setState({
      board: {
        running: { conversationId: HERE, task: "Book the flight", owner: "panel", startedAt: 1 },
        queue: [],
      },
    });

    const { container } = await render();
    expect(container.querySelector("section")).toBeNull();
  });

  it("names a run driving another conversation — nothing else here can", async () => {
    useConversationStore.setState({
      board: {
        running: {
          conversationId: ELSEWHERE,
          task: "Book the flight",
          owner: "panel",
          startedAt: 1,
        },
        queue: [],
      },
    });

    const { container } = await render();
    expect(container.textContent).toContain("Book the flight");
  });

  it("drops our own queued card and keeps the line's real numbering", async () => {
    useConversationStore.setState({
      board: {
        running: { conversationId: ELSEWHERE, task: "Running", owner: "panel", startedAt: 1 },
        queue: [queued("mine", HERE, "My queued task"), queued("theirs", ELSEWHERE, "Their task")],
      },
      queuedRun: { id: "mine", position: 1, task: "My queued task" },
    });

    const { container } = await render();
    // The composer already carries ours, with its position and cancel.
    expect(container.textContent).not.toContain("My queued task");
    expect(container.textContent).toContain("Their task");
    // Still #2: hiding ours must not renumber the one behind it, or the strip
    // and the composer card would name different positions for the same line.
    expect(container.textContent).toContain("2");
  });
});
