import { describe, it, expect } from "vitest";
import { buildTaskMessage } from "../prompt";

describe("buildTaskMessage", () => {
  it("pairs the task with the starting-page snapshot and the current date", () => {
    const message = buildTaskMessage("summarize this page", 'button "Go" [ref=e1]');
    expect(message).toMatch(
      /^Task: summarize this page\n\nCurrent page:\nbutton "Go" \[ref=e1\]\n\nCurrent date: \d{4}-\d{2}-\d{2} \(\w+\)$/,
    );
  });

  it("points at the one previous tab when the run moved", () => {
    const message = buildTaskMessage("now archive that email", '- heading "Doc"', {
      previousTabs: [{ title: "Gmail — Inbox", url: "https://mail.google.com/mail/u/0/" }],
    });

    expect(message).toContain("Task: now archive that email");
    expect(message).toContain('Current page:\n- heading "Doc"');
    expect(message).toContain('another tab: "Gmail — Inbox" (https://mail.google.com/mail/u/0/)');
    expect(message).toContain("switch_tab");
  });

  it("lists every earlier tab of a multi-tab conversation", () => {
    const message = buildTaskMessage("send it to that client", '- heading "Doc"', {
      previousTabs: [
        { title: "Gmail — Inbox", url: "https://mail.google.com/" },
        { title: "Q3 Invoice", url: "https://docs.google.com/document/d/1" },
      ],
    });

    expect(message).toContain("other tabs:");
    expect(message).toContain('"Gmail — Inbox" (https://mail.google.com/)');
    expect(message).toContain('"Q3 Invoice" (https://docs.google.com/document/d/1)');
    expect(message).toContain("any of them");
  });

  it("tells a background run it has a tab of its own", () => {
    const message = buildTaskMessage("book the flight", '- heading "Flights"', {
      mode: { background: true },
    });

    expect(message).toContain("tab of your own");
    expect(message).toContain("switch_tab only when");
  });

  it("tells an adopted run it drives the user's tab and must plan before acting", () => {
    const message = buildTaskMessage("book the flight", '- heading "Flights"', {
      mode: { background: true, adopted: true },
    });

    expect(message).not.toContain("tab of your own");
    expect(message).toContain("driving the user's current tab");
    expect(message).toContain("propose a plan before any action");
  });

  it("says nothing about tabs when the run drives the user's own page", () => {
    const message = buildTaskMessage("book the flight", '- heading "Flights"', {
      mode: { background: false },
    });

    expect(message).not.toContain("tab of your own");
    expect(message).not.toContain("driving the user's current tab");
  });

  // Without its own id a scheduled run can only guess which of the listed
  // schedules it is, so it can never reliably cancel itself — which is how a
  // "keep checking until X" loop is supposed to end.
  it("names the schedule a scheduled run fired from", () => {
    const message = buildTaskMessage("check the delivery", '- heading "Orders"', {
      mode: { background: true },
      scheduleId: "sched-42",
    });

    expect(message).toContain("sched-42");
    expect(message).toContain("scheduled task firing on its own");
  });

  it("says nothing about schedules for an ordinary run", () => {
    const message = buildTaskMessage("check the delivery", '- heading "Orders"', {
      mode: { background: true },
    });

    expect(message).not.toContain("scheduled task firing on its own");
  });
});
