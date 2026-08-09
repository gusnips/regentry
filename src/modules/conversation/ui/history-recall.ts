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

/** Where the composer is in the ↑ history. */
export interface Browse {
  /** Position in the history; `null` means "editing your own draft". */
  index: number | null;
  /** What the composer shows. */
  text: string;
  /** The unsent draft the browse started from — where ↓ past the newest lands. */
  draft: string;
}

/**
 * One step through the sent history. Returns null when the arrow is not a
 * recall — the caret should move instead.
 *
 * - A filled composer browses too: your draft is stashed on the way out and
 *   handed back when ↓ walks past the newest entry, so nothing is ever lost.
 * - The line the caret sits on decides: ↑ recalls only from the first line and
 *   ↓ only from the last, so arrows still navigate a multi-line draft. Logical
 *   lines, not wrapped ones — a soft wrap is not a break you typed.
 * - Browsing holds only while the composer still shows the recalled entry; an
 *   edit, a send, or a conversation switch makes it your draft again, and the
 *   next ↑ starts over from the newest.
 * - ↑ at the oldest entry holds rather than wrapping — a wrap silently loses
 *   your place in a long history.
 */
export function recallStep(
  key: "ArrowUp" | "ArrowDown",
  history: string[],
  state: { index: number | null; text: string; caret: number; draft: string },
): Browse | null {
  const { text, caret } = state;
  const onEdgeLine =
    key === "ArrowUp" ? text.lastIndexOf("\n", caret - 1) === -1 : text.indexOf("\n", caret) === -1;
  if (!onEdgeLine) return null;

  const at = state.index !== null && history[state.index] === text ? state.index : null;
  const draft = at === null ? text : state.draft;
  const next = (at ?? -1) + (key === "ArrowUp" ? 1 : -1);
  // Below the newest is your own draft — and below that, nothing to recall.
  if (next < 0) return at === null ? null : { index: null, text: draft, draft };
  const recalled = history[next];
  return recalled === undefined ? null : { index: next, text: recalled, draft };
}
