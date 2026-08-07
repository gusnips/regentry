import { describe, it, expect } from "vitest";
import { buildTaskMessage } from "../prompt";

describe("buildTaskMessage", () => {
  it("pairs the task with the starting-page snapshot", () => {
    const message = buildTaskMessage("summarize this page", "button \"Go\" [ref=e1]");
    expect(message).toBe("Task: summarize this page\n\nCurrent page:\nbutton \"Go\" [ref=e1]");
  });

  it("adds a pointer to the previous run's tab only when it differs", () => {
    const previousTab = { title: "Gmail — Inbox", url: "https://mail.google.com/mail/u/0/" };
    const message = buildTaskMessage("now archive that email", "- heading \"Doc\"", previousTab);

    expect(message).toContain("Task: now archive that email");
    expect(message).toContain("Current page:\n- heading \"Doc\"");
    expect(message).toContain('"Gmail — Inbox" (https://mail.google.com/mail/u/0/)');
    expect(message).toContain("switch_tab");
  });
});
