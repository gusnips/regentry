import type { Message } from "@/modules/conversation/types";
import type { ChatMessage } from "@/modules/providers/types";
import { truncate } from "@/lib/logger";

/**
 * Per-entry cap — one enormous message must not crowd out the conversation
 * around it. Generous on purpose: an assistant answer often IS the payload the
 * next message refers to ("search those names"), and a cap that cuts the list
 * in half leaves the model working from half a list.
 */
const MAX_ENTRY = 4_000;
/**
 * Total budget over the replayed conversation, spent newest-first — recent
 * exchanges are what a follow-up refers to. The first user message (the
 * original task) is always kept, whatever else is dropped.
 *
 * ponytail: characters, not tokens, and no per-model ceiling — ~24k chars is
 * roughly 6k tokens, small beside the page snapshot every run already carries.
 * Upgrade path is trimming against the resolved model's real context window.
 */
const MAX_HISTORY_CHARS = 24_000;

const IMAGE_TOKEN = /\s?\[Image #\d+\]/g;

/**
 * The conversation as alternating wire turns: every user message (the task,
 * the corrections, the answers) and the assistant's replies in its own words.
 * Steps, plans and reasoning stay out — what happened lives in the assistant's
 * summaries (an interrupted run gets a deterministic one — progress-note.ts —
 * so the summary exists even when the model never wrote one), and the fresh
 * run re-reads the page itself. Both adapters
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

  // Spend the budget newest-first, then keep the original task on top: the
  // model needs what was just said, and why it was ever asked.
  const first = entries[0];
  let budget = MAX_HISTORY_CHARS - (first?.content.length ?? 0);
  let keptFrom = entries.length;
  while (keptFrom > 1 && budget - entries[keptFrom - 1]!.content.length >= 0) {
    keptFrom -= 1;
    budget -= entries[keptFrom]!.content.length;
  }
  const kept = first ? [first, ...entries.slice(Math.max(keptFrom, 1))] : [];

  // The wire requires alternating roles — merge runs of the same role (several
  // assistant bubbles per run, back-to-back user notes, or the trim seam).
  const turns: ChatMessage[] = [];
  for (const entry of kept) {
    const prev = turns[turns.length - 1];
    if (prev && prev.role === entry.role) prev.content += `\n\n${entry.content}`;
    else turns.push({ ...entry });
  }
  return turns;
}
