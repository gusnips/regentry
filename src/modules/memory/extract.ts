import type { ChatMessage, ResolvedProviderConfig } from "@/modules/providers/types";
import { createProvider } from "@/modules/providers";
import { createLogger, truncate } from "@/lib/logger";
import { getDoc, memoryEnabled, remember } from "./documents";

const log = createLogger("memory");

/** Hard ceiling per run — a run that teaches more than this is one-off noise. */
const MAX_FACTS_PER_RUN = 3;

/**
 * The extraction turn's system prompt. Mirrors claude-code-original's
 * `extractMemories` prompt in the minimum Regentry needs: no taxonomy, one flat
 * memory list, a strict "what not to save". The current MEMORY.md rides along so
 * the model doesn't re-save what it already knows (`remember()` dedups anyway).
 */
export function buildExtractionSystemPrompt(memory: string): string {
  return `Below is the transcript of a browser-automation run that just completed. Review it and identify durable facts worth remembering for future runs.

A durable fact is something that will still be true next time and that a future run should know before it starts:
- A stable fact about the user (their accounts, email, how they prefer things done).
- A site quirk discovered the hard way (the working login on a site, a form that needs a specific step, a misleading page structure).

Do NOT save:
- One-off task details ("archived the email", "the price was $50") — those belong to this task only.
- Anything already in the memory below.
- Secrets: passwords, API keys, card numbers, or login credentials.
- More than 2 facts — save only what is clearly durable.

Reply with only the facts, one per line, each starting with "- ". If nothing is durable, reply with exactly: none

Current memory:
${memory || "(empty)"}`;
}

/**
 * The transcript the extraction call sees: the run's wire messages minus the
 * system prompt, with everything the extraction turn cannot use stripped —
 * screenshots (`data:` URLs — huge) and reasoning. Tool calls and results stay,
 * so the model can tell what the run actually did.
 * ponytail: sends the whole text-only transcript; if cost ever matters, cap to
 * the last N messages here — extraction only needs the run's highlights.
 */
export function buildExtractionMessages(transcript: ChatMessage[], memory: string): ChatMessage[] {
  const messages: ChatMessage[] = [{ role: "system", content: buildExtractionSystemPrompt(memory) }];
  for (const m of transcript) {
    if (m.role === "system") continue;
    messages.push({
      role: m.role,
      content: m.content,
      toolCalls: m.toolCalls,
      toolResults: m.toolResults?.map((r) => ({ id: r.id, content: r.content })),
    });
  }
  return messages;
}

/**
 * Parse the extraction reply. Only explicit list lines count — a model that
 * answers in prose saves nothing, which is safer than remembering a stray
 * sentence. "none" lines are skipped; stray preamble lines are skipped.
 */
export function parseExtractedFacts(reply: string): string[] {
  const facts: string[] = [];
  for (const line of reply.split("\n")) {
    const trimmed = line.trim();
    if (/^none\.?$/i.test(trimmed)) continue;
    if (!/^[-*]\s+/.test(trimmed)) continue;
    const fact = trimmed.replace(/^[-*]\s+/, "").trim();
    if (fact) facts.push(fact);
    if (facts.length >= MAX_FACTS_PER_RUN) break;
  }
  return facts;
}

/**
 * One best-effort extraction call at run end: replay the run's text-only
 * transcript to the model, parse the durable facts it names, and remember each.
 * Never throws — memory is a nice-to-have, a failed call must not surface.
 */
export async function extractAndRemember(
  config: ResolvedProviderConfig,
  transcript: ChatMessage[],
  signal: AbortSignal,
): Promise<void> {
  try {
    // Same gate as buildToolDefs — memory off means nothing is loaded or written.
    if (!(await memoryEnabled.get())) return;
    if (signal.aborted) return;

    const memory = await getDoc("MEMORY.md");
    const messages = buildExtractionMessages(transcript, memory);
    // The extraction turn needs no thinking tokens and sees no images.
    const extraction = createProvider({ ...config, reasoningEffort: undefined, supportsImages: false });

    let reply = "";
    for await (const delta of extraction.stream(messages, [], signal)) {
      if (delta.type === "text") reply += delta.text;
    }

    for (const fact of parseExtractedFacts(reply)) {
      const stored = await remember(fact);
      if (stored) log.info("remembered:", truncate(stored, 100));
    }
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    log.debug("extraction skipped:", message);
  }
}
