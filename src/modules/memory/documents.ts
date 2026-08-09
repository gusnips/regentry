import { defineItem } from "@/lib/storage";

/**
 * The two markdown documents TabRunner loads into every run, mirroring the
 * AGENTS.md / MEMORY.md convention coding agents settled on:
 *
 * - `AGENTS.md` is yours. Standing instructions that outlive any one task
 *   ("my work account is …", "always confirm before submitting a payment").
 * - `MEMORY.md` is the agent's. It writes durable facts there with the
 *   `remember` tool so the next run starts where the last one left off.
 *
 * There is no filesystem in an extension, so these are storage-backed strings
 * edited on the options page — the filenames are the mental model, not a path.
 */
export const DOC_NAMES = ["AGENTS.md", "MEMORY.md"] as const;
export type DocName = (typeof DOC_NAMES)[number];

/**
 * On out of the box: an agent that re-learns the same page dance every run is
 * the weaker default. Off stops both halves — nothing is read, nothing is
 * written, and the `remember` tool is not offered to the model at all.
 */
export const memoryEnabled = defineItem<boolean>("memoryEnabled", true);

const docItem = (name: DocName) => defineItem<string>(`doc:${name}`, "");

/**
 * ponytail: memory is a flat, line-oriented bullet list capped by characters,
 * oldest-first — not scored, dated, or deduped by meaning. Ceilings: a fact
 * that goes stale sits there until the user edits it out, and a user who
 * writes multi-line prose in MEMORY.md can have a paragraph split by eviction.
 * Upgrade path is one record per memory with a timestamp and a relevance pass.
 */
const MAX_MEMORY_CHARS = 8_000;

export function getDoc(name: DocName): Promise<string> {
  return docItem(name).get();
}

export function setDoc(name: DocName, content: string): Promise<void> {
  return docItem(name).set(content);
}

export function watchDoc(name: DocName, cb: (content: string) => void): () => void {
  return docItem(name).watch(cb);
}

/** Bullet lines only — blank lines and list markers are noise for comparison. */
function entries(doc: string): string[] {
  return doc.split("\n").filter((line) => line.trim() !== "");
}

function normalize(line: string): string {
  return line
    .replace(/^\s*[-*]\s+/, "")
    .trim()
    .toLowerCase();
}

/**
 * Appends one fact to MEMORY.md. Returns the stored entry, or null if the
 * model sent something empty. Re-remembering a known fact is a no-op rather
 * than an error — models restate what they already know all the time.
 */
export async function remember(fact: string): Promise<string | null> {
  // Collapse first, then trim, then drop a list marker the model added itself —
  // stripping before the trim misses "  - fact", which is what they actually send.
  const entry = fact
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^[-*]\s*/, "")
    .trim();
  if (!entry) return null;

  const item = docItem("MEMORY.md");
  const lines = entries(await item.get());
  if (lines.some((line) => normalize(line) === normalize(entry))) return entry;

  lines.push(`- ${entry}`);
  // Evict oldest first, but never the entry we just wrote.
  while (lines.length > 1 && lines.join("\n").length > MAX_MEMORY_CHARS) lines.shift();
  await item.set(`${lines.join("\n")}\n`);
  return entry;
}

/** MEMORY.md as displayable facts — stored bullets with the list marker stripped. */
export function listMemory(doc: string): string[] {
  return entries(doc)
    .map((line) => line.replace(/^\s*[-*]\s+/, "").trim())
    .filter(Boolean);
}

/** Delete one fact from MEMORY.md — matched by display text, so the list and the store agree. */
export async function removeMemory(entry: string): Promise<void> {
  const lines = entries(await getDoc("MEMORY.md")).filter(
    (line) => line.replace(/^\s*[-*]\s+/, "").trim() !== entry,
  );
  await setDoc("MEMORY.md", lines.length > 0 ? `${lines.join("\n")}\n` : "");
}

/** Everything the agent's system prompt needs, resolved once at run start. */
export interface AgentContext {
  /** AGENTS.md — always loaded; the toggle governs memory, not your instructions. */
  instructions: string;
  /** MEMORY.md — empty string when memory is off. */
  memory: string;
  memoryOn: boolean;
}

export async function loadAgentContext(): Promise<AgentContext> {
  const [instructions, memoryOn] = await Promise.all([getDoc("AGENTS.md"), memoryEnabled.get()]);
  return {
    instructions: instructions.trim(),
    memory: memoryOn ? (await getDoc("MEMORY.md")).trim() : "",
    memoryOn,
  };
}
