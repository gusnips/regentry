import type { Message } from "@/modules/conversation/types";
import type { ChatMessage } from "@/modules/providers/types";
import { truncate } from "@/lib/logger";

/** Per-entry cap — history is context about intent and outcome, not a payload dump. */
const MAX_ENTRY = 600;
/**
 * Window over the conversation. The first user message — the original task —
 * always survives; overflow drops the middle-oldest exchanges, never it.
 * ponytail: a message count, not a token budget; at 40 capped entries the worst
 * case is a few thousand tokens. Upgrade path is trimming against the model's
 * real context window.
 */
const MAX_HISTORY_MESSAGES = 40;

const IMAGE_TOKEN = /\s?\[Image #\d+\]/g;

/**
 * The conversation as alternating wire turns: every user message (the task,
 * the corrections, the answers) and the assistant's replies in its own words.
 * Steps, plans and reasoning stay out — what happened lives in the assistant's
 * summaries, and the fresh run re-reads the page itself. Both adapters
 * serialize these turns with the same code path as the run's own.
 */
export function buildConversationHistory(transcript: Message[]): ChatMessage[] {
  // The last user message is the run about to start — the loop builds its task
  // message itself, so history ends right before it.
  const lastUser = transcript.map((m) => m.role).lastIndexOf("user");
  if (lastUser === -1) return [];
  const past = transcript.slice(0, lastUser);

  const entries: ChatMessage[] = [];
  for (const m of past) {
    // ask_user steps join as assistant turns — without them the user's answer
    // would replay as a reply to a question the model never sees.
    const role = m.role === "step" && m.tool === "ask_user" ? "assistant" : m.role;
    if (role !== "user" && role !== "assistant") continue;
    const content = truncate(m.content, MAX_ENTRY).replace(IMAGE_TOKEN, "").trim();
    if (content) entries.push({ role, content });
  }

  if (entries.length > MAX_HISTORY_MESSAGES) {
    // Keep the original task (entries[0]) plus the newest exchanges.
    entries.splice(1, entries.length - MAX_HISTORY_MESSAGES);
  }

  // The wire requires alternating roles — merge runs of the same role (several
  // assistant bubbles per run, back-to-back user notes, or the trim seam).
  const turns: ChatMessage[] = [];
  for (const entry of entries) {
    const prev = turns[turns.length - 1];
    if (prev && prev.role === entry.role) prev.content += `\n\n${entry.content}`;
    else turns.push({ ...entry });
  }
  return turns;
}
