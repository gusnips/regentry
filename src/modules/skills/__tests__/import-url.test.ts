import { describe, it, expect, vi, afterEach } from "vitest";
import { fetchSkillMarkdown, resolveSkillSource } from "../import-url";

function urlOf(input: string): string {
  const source = resolveSkillSource(input);
  if (!source.ok) throw new Error(`expected ok for ${input}, got ${source.reason}`);
  return source.url;
}

describe("resolveSkillSource", () => {
  it("rewrites GitHub blob and tree URLs to the raw file", () => {
    expect(urlOf("https://github.com/acme/skills/blob/main/pay-rent/SKILL.md")).toBe(
      "https://raw.githubusercontent.com/acme/skills/main/pay-rent/SKILL.md",
    );
    // A tree URL names a directory — the canonical file name is appended.
    expect(urlOf("https://github.com/acme/skills/tree/main/pay-rent")).toBe(
      "https://raw.githubusercontent.com/acme/skills/main/pay-rent/SKILL.md",
    );
  });

  it("expands the owner/repo shorthand, with and without a path", () => {
    expect(urlOf("acme/skills")).toBe(
      "https://raw.githubusercontent.com/acme/skills/HEAD/SKILL.md",
    );
    expect(urlOf("acme/skills/pay-rent")).toBe(
      "https://raw.githubusercontent.com/acme/skills/HEAD/pay-rent/SKILL.md",
    );
    expect(urlOf("acme/skills/pay-rent/SKILL.md")).toBe(
      "https://raw.githubusercontent.com/acme/skills/HEAD/pay-rent/SKILL.md",
    );
  });

  it("passes any other https URL through verbatim", () => {
    expect(urlOf("https://example.com/my/skill.md?x=1")).toBe(
      "https://example.com/my/skill.md?x=1",
    );
  });

  it("refuses http and anything unparseable, each with its reason", () => {
    expect(resolveSkillSource("http://example.com/skill.md")).toEqual({
      ok: false,
      reason: "http",
    });
    expect(resolveSkillSource("not a url at all")).toEqual({ ok: false, reason: "unparseable" });
    expect(resolveSkillSource("")).toEqual({ ok: false, reason: "unparseable" });
  });
});

describe("fetchSkillMarkdown", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("returns a body within the cap", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("---\nname: a\n---\nsteps")));
    await expect(fetchSkillMarkdown("https://example.com/SKILL.md")).resolves.toContain("steps");
  });

  it("caps the streamed body — a server that lies about size can't fill memory", async () => {
    // No content-length header, so only the capped read can catch it.
    const big = new ReadableStream<Uint8Array>({
      start(c) {
        c.enqueue(new Uint8Array(200_000));
        c.enqueue(new Uint8Array(200_000));
        c.close();
      },
    });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(big)));
    await expect(fetchSkillMarkdown("https://example.com/SKILL.md")).rejects.toThrow();
  });
});
