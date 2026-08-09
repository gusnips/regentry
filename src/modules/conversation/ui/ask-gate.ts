import type { AgentStatus, Message } from "../types";

/**
 * The one ask_user a reply would land on: the newest question with no user
 * message after it, and only while no run is in flight. A message that is not
 * a reply — the summary sentence the model streamed alongside its ask_user
 * call lands AFTER the card — must never close the gate; a user message must
 * (the reply already sits in the transcript below the question). MessageList
 * gates the card's chips/hint on this, ChatInput the composer's answer
 * placeholder — one scan so the two surfaces never disagree about which
 * question is still awaiting an answer.
 */
export function pendingAskId(messages: Message[], status: AgentStatus): string | undefined {
  if (status === "running") return undefined;
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m?.role === "user") return undefined;
    if (m?.role === "step" && m.tool === "ask_user") return m.id;
  }
  return undefined;
}
