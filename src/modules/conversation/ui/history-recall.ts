import type { Message } from "../types";

/**
 * What you sent in this conversation, newest first — the ↑ history.
 * Consecutive repeats collapse, as in a shell: pressing ↑ twice should move you
 * back two messages, not show you the same one again.
 */
export function sentMessages(messages: Message[]): string[] {
  const sent: string[] = [];
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m?.role !== "user" || !m.content.trim()) continue;
    if (sent[sent.length - 1] !== m.content) sent.push(m.content);
  }
  return sent;
}

/** Where an arrow key lands: `null` index means "back to the fresh draft". */
export interface Recall {
  index: number | null;
  text: string;
}

/**
 * One step through the sent history. Returns null when the arrow is not a
 * recall — the caret should move instead, which is what arrows do in every
 * other multiline input.
 *
 * - Only an empty composer starts browsing; once browsing, arrows keep browsing
 *   however long the recalled text is.
 * - An empty composer is always a fresh draft, whatever the last position was:
 *   switching conversations empties it, and resuming someone else's place would
 *   hand you a message from a transcript you left.
 * - ↑ at the oldest entry holds rather than wrapping — a wrap silently loses
 *   your place in a long history.
 * - ↓ past the newest returns the empty draft you started from.
 */
export function recallStep(
  key: "ArrowUp" | "ArrowDown",
  index: number | null,
  text: string,
  history: string[],
): Recall | null {
  // An empty composer is a fresh draft, whatever position it was left at.
  const at = index !== null && text !== "" ? index : null;
  if (at === null && (key === "ArrowDown" || text !== "")) return null;

  const next = (at ?? -1) + (key === "ArrowUp" ? 1 : -1);
  if (next < 0) return { index: null, text: "" };
  const recalled = history[next];
  return recalled === undefined ? null : { index: next, text: recalled };
}
