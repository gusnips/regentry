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
    const message = buildTaskMessage("now archive that email", '- heading "Doc"', [
      { title: "Gmail — Inbox", url: "https://mail.google.com/mail/u/0/" },
    ]);

    expect(message).toContain("Task: now archive that email");
    expect(message).toContain('Current page:\n- heading "Doc"');
    expect(message).toContain('another tab: "Gmail — Inbox" (https://mail.google.com/mail/u/0/)');
    expect(message).toContain("switch_tab");
  });

  it("lists every earlier tab of a multi-tab conversation", () => {
    const message = buildTaskMessage("send it to that client", '- heading "Doc"', [
      { title: "Gmail — Inbox", url: "https://mail.google.com/" },
      { title: "Q3 Invoice", url: "https://docs.google.com/document/d/1" },
    ]);

    expect(message).toContain("other tabs:");
    expect(message).toContain('"Gmail — Inbox" (https://mail.google.com/)');
    expect(message).toContain('"Q3 Invoice" (https://docs.google.com/document/d/1)');
    expect(message).toContain("any of them");
  });
});
