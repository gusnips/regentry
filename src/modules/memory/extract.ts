import type { ChatMessage, ResolvedProviderConfig } from "@/modules/providers/types";
import { createProvider } from "@/modules/providers";
import { createLogger, truncate } from "@/lib/logger";
import { getDoc, memoryEnabled, remember } from "./documents";

const log = createLogger("memory");

/** Hard ceiling per run — a run that teaches more than this is one-off noise. */
const MAX_FACTS_PER_RUN = 3;

/**
 * One message's text ceiling on the extraction wire. Snapshots dominate a run's
 * transcript and the distillation only needs the gist of each step — full pages
 * would make the call slow enough to outlive the service worker hosting it.
 */
const MAX_MESSAGE_CHARS = 4_000;

/** A hung provider must not pin the worker (and its keepalive alarm) forever. */
const EXTRACTION_TIMEOUT_MS = 90_000;

/**
 * The extraction turn's system prompt. Mirrors claude-code-original's
 * `extractMemories` prompt in the minimum TabRunner needs: no taxonomy, one flat
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
- More than 3 facts — save only what is clearly durable.

Reply with only the facts, one per line, each starting with "- ". If nothing is durable, reply with exactly: none

Current memory:
${memory || "(empty)"}`;
}

function capText(text: string): string {
  return text.length > MAX_MESSAGE_CHARS ? `${text.slice(0, MAX_MESSAGE_CHARS)}…` : text;
}

/**
 * The transcript the extraction call sees: the run's wire messages minus the
 * system prompt, with everything the extraction turn cannot use stripped —
 * screenshots (`data:` URLs — huge) and reasoning. Tool calls and results stay,
 * so the model can tell what the run actually did.
 *
 * Two wire-validity rules keep the replay from being rejected outright:
 *
 * - A run's last turn ends on `done`/`ask_user`, whose result the loop never
 *   records — replayed verbatim, that unmatched tool call 400s the extraction
 *   request on every strict provider (Anthropic, OpenAI alike). Only calls
 *   that got a result ride along.
 * - Oversized texts are capped, so a long run's transcript stays a quick,
 *   cheap call instead of a full page-by-page replay.
 */
export function buildExtractionMessages(transcript: ChatMessage[], memory: string): ChatMessage[] {
  const answered = new Set(transcript.flatMap((m) => (m.toolResults ?? []).map((r) => r.id)));
  const messages: ChatMessage[] = [
    { role: "system", content: buildExtractionSystemPrompt(memory) },
  ];
  for (const m of transcript) {
    if (m.role === "system") continue;
    const toolCalls = m.toolCalls?.filter((c) => answered.has(c.id));
    const content = capText(m.content);
    // An assistant turn that was only a done/ask_user call is empty once its
    // call is filtered out — and an empty message is its own wire error.
    if (m.role === "assistant" && !content && !toolCalls?.length) continue;
    messages.push({
      role: m.role,
      content,
      toolCalls: toolCalls?.length ? toolCalls : undefined,
      toolResults: m.toolResults?.map((r) => ({ id: r.id, content: capText(r.content) })),
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
 * Never throws — memory is a nice-to-have, a failed call must not surface. It
 * IS logged at warn, though: a silently-dying extraction once shipped as
 * "memory never works", invisible at debug level.
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
    const extraction = createProvider({
      ...config,
      reasoningEffort: undefined,
      supportsImages: false,
    });

    // The run's signal is not expected to fire (extraction is skipped on stop),
    // but the timeout is real: a hung stream must release the worker.
    const bounded = AbortSignal.any([signal, AbortSignal.timeout(EXTRACTION_TIMEOUT_MS)]);
    let reply = "";
    for await (const delta of extraction.stream(messages, [], bounded)) {
      if (delta.type === "text") reply += delta.text;
    }

    for (const fact of parseExtractedFacts(reply)) {
      const stored = await remember(fact);
      if (stored) log.info("remembered:", truncate(stored, 100));
    }
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    if (signal.aborted) log.debug("extraction aborted:", message);
    else log.warn("extraction failed:", message);
  }
}
