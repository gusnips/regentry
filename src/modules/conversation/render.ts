import type { Message } from "./types";

/**
 * A stored transcript message as plain text — the panel's own view of the run.
 * The one renderer every transcript→model distillation shares: compaction
 * summaries and skill drafts must read the same record the same way.
 */
export function renderTranscriptMessage(m: Message): string {
  switch (m.role) {
    case "user":
      return `USER: ${m.content}`;
    case "assistant":
    case "summary":
      return `AGENT: ${m.content}`;
    case "step":
      return m.tool
        ? `ACTION ${m.tool}${m.ok === false ? " (failed)" : ""}: ${m.content}`
        : `NOTE: ${m.content}`;
    case "error":
      return `ERROR: ${m.content}`;
    case "plan":
      return m.steps?.length ? `PLAN: ${m.steps.join(" | ")}` : "";
    // Reasoning is the one thing never worth carrying: it argues about a page
    // that has since been navigated away from.
    case "reasoning":
      return "";
  }
}
