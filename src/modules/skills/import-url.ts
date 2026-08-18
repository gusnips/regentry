import { i18n } from "@/i18n";

/**
 * What the import field accepts, resolved to one https URL to fetch:
 *
 * - a raw https URL to a markdown file — used verbatim
 * - a GitHub blob/tree URL — rewritten to raw.githubusercontent.com
 * - the `owner/repo[/path]` shorthand — the way skill repos are passed around
 *
 * Pure string logic; the fetch itself is `fetchSkillMarkdown` below.
 */
export type SkillSource = { ok: true; url: string } | { ok: false; reason: "http" | "unparseable" };

const RAW_HOST = "https://raw.githubusercontent.com";
/** `owner/repo` or `owner/repo/path/to/skill` — no scheme, no spaces. */
const SHORTHAND = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+(\/\S+)?$/;

/** A path that names a directory gets the canonical file name appended. */
function withSkillFile(path: string): string {
  return path.endsWith(".md") ? path : `${path.replace(/\/+$/, "")}/SKILL.md`;
}

export function resolveSkillSource(input: string): SkillSource {
  const raw = input.trim();
  if (!raw) return { ok: false, reason: "unparseable" };
  if (/^http:\/\//i.test(raw)) return { ok: false, reason: "http" };

  if (/^https:\/\//i.test(raw)) {
    let url: URL;
    try {
      url = new URL(raw);
    } catch {
      return { ok: false, reason: "unparseable" };
    }
    if (url.hostname !== "github.com") return { ok: true, url: url.toString() };
    // github.com/<owner>/<repo>[/blob|tree/<ref>/<path>] → the raw file behind it.
    const [owner, repo, kind, ref, ...rest] = url.pathname.split("/").filter(Boolean);
    if (!owner || !repo) return { ok: false, reason: "unparseable" };
    if ((kind === "blob" || kind === "tree") && ref) {
      return {
        ok: true,
        url: `${RAW_HOST}/${owner}/${repo}/${ref}/${withSkillFile(rest.join("/"))}`,
      };
    }
    if (!kind) return { ok: true, url: `${RAW_HOST}/${owner}/${repo}/HEAD/SKILL.md` };
    return { ok: false, reason: "unparseable" };
  }

  if (SHORTHAND.test(raw)) {
    const [owner, repo, ...rest] = raw.split("/");
    const path = rest.length ? withSkillFile(rest.join("/")) : "SKILL.md";
    return { ok: true, url: `${RAW_HOST}/${owner}/${repo}/HEAD/${path}` };
  }
  return { ok: false, reason: "unparseable" };
}

/** A skill is prose — anything bigger than this is not a skill file. */
const MAX_SKILL_FETCH_BYTES = 262_144;

/** Read the body no further than the cap — a chunked or lying server must not fill memory. */
async function readCapped(body: ReadableStream<Uint8Array>): Promise<string> {
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let received = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    received += value.byteLength;
    if (received > MAX_SKILL_FETCH_BYTES) {
      void reader.cancel();
      throw new Error(i18n.t("skills.import.errorTooLarge"));
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(received);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(bytes);
}

/**
 * Fetch the resolved URL, bounded in time and size. Runs from the dialog's own
 * page context (the `/usage` precedent) — user-initiated, one URL the user
 * typed, never from the worker. Throws i18n'd messages the dialog shows as-is;
 * the caller's own abort (dialog closed) passes through untouched.
 */
export async function fetchSkillMarkdown(url: string, signal?: AbortSignal): Promise<string> {
  const timeout = AbortSignal.timeout(10_000);
  let res: Response;
  try {
    res = await fetch(url, { signal: signal ? AbortSignal.any([signal, timeout]) : timeout });
  } catch (e) {
    throw new Error(
      i18n.t(timeout.aborted ? "skills.import.errorTimeout" : "skills.import.errorNetwork"),
      { cause: e },
    );
  }
  if (!res.ok) throw new Error(i18n.t("skills.import.errorStatus", { status: res.status }));
  const length = Number(res.headers.get("content-length") ?? 0);
  if (length > MAX_SKILL_FETCH_BYTES) throw new Error(i18n.t("skills.import.errorTooLarge"));
  const text = res.body ? await readCapped(res.body) : "";
  if (!text.trim()) throw new Error(i18n.t("skills.import.errorEmpty"));
  return text;
}
