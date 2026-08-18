import { normalizeHost } from "@/lib/host";
import type { Skill } from "./types";
import { normalizeSkillName } from "./types";

/**
 * SKILL.md is the interchange form — import (URL or paste), export, and the
 * distillation reply all pass through this one parser. Storage stays the
 * structured record; markdown exists only at the edges.
 *
 * The grammar is a deliberate subset of YAML frontmatter, hand-rolled (no YAML
 * dependency exists in this repo and one file format doesn't earn one):
 * `key: value` split on the FIRST colon so prose colons survive, `- item`
 * block lists, `[a, b]` inline lists — lists only for site keys, so a
 * description that happens to start with "[" stays prose. Tolerance is the
 * contract: a Claude Code SKILL.md with `allowed-tools`, `model`, or any
 * future key must import cleanly — unknown keys are reported, never fatal,
 * and a file with no frontmatter at all is just a body.
 */
export interface ParsedSkillMd {
  /** Normalized, valid name — absent when the file named nothing usable. */
  name?: string;
  description?: string;
  /** Normalized hosts, deduped. */
  sites: string[];
  body: string;
  /** Frontmatter keys present but not honored — a quiet preview note, never an error. */
  ignoredKeys: string[];
  /** Site entries that didn't normalize to a host — a preview warning. */
  droppedSites: string[];
}

const KEY_LINE = /^([A-Za-z][\w-]*)\s*:\s*(.*)$/;
const LIST_ITEM = /^\s*-\s+(.*)$/;

function unquote(value: string): string {
  const t = value.trim();
  const q = t[0];
  return (q === '"' || q === "'") && t.length >= 2 && t.endsWith(q) ? t.slice(1, -1) : t;
}

/** Frontmatter as raw key → scalar or list, with everything unrecognized skipped. */
function parseFrontmatter(lines: string[]): Map<string, string | string[]> {
  const entries = new Map<string, string | string[]>();
  for (let i = 0; i < lines.length; i++) {
    const match = KEY_LINE.exec(lines[i] ?? "");
    if (!match?.[1]) continue;
    const key = match[1].toLowerCase().replaceAll("-", "_");
    const value = (match[2] ?? "").trim();
    if (value) {
      entries.set(key, unquote(value));
      continue;
    }
    // A bare `key:` opens a block list — consume its `- item` lines.
    const items: string[] = [];
    while (i + 1 < lines.length) {
      const item = LIST_ITEM.exec(lines[i + 1] ?? "");
      if (!item?.[1]) break;
      items.push(unquote(item[1]));
      i++;
    }
    entries.set(key, items);
  }
  return entries;
}

/** `[a, b]` / block list / bare scalar → list of raw entries. */
function asList(value: string | string[]): string[] {
  if (Array.isArray(value)) return value;
  const inline = /^\[(.*)\]$/.exec(value.trim());
  const parts = inline?.[1] !== undefined ? inline[1].split(",") : [value];
  return parts.map((p) => unquote(p)).filter(Boolean);
}

function asScalar(value: string | string[]): string {
  return Array.isArray(value) ? value.join(" ").trim() : value;
}

export function parseSkillMd(text: string): ParsedSkillMd {
  const lines = text.split(/\r?\n/);
  let start = 0;
  while (start < lines.length && !(lines[start] ?? "").trim()) start++;

  let front = new Map<string, string | string[]>();
  let body = text.trim();
  if ((lines[start] ?? "").trim() === "---") {
    const close = lines.findIndex((l, i) => i > start && l.trim() === "---");
    // No closing fence: not frontmatter, just a document that opens with a rule.
    if (close !== -1) {
      front = parseFrontmatter(lines.slice(start + 1, close));
      body = lines
        .slice(close + 1)
        .join("\n")
        .trim();
    }
  }

  const sites: string[] = [];
  const droppedSites: string[] = [];
  for (const key of ["site", "sites"]) {
    const value = front.get(key);
    if (value === undefined) continue;
    for (const raw of asList(value)) {
      const host = normalizeHost(raw);
      if (!host) droppedSites.push(raw);
      else if (!sites.includes(host)) sites.push(host);
    }
  }

  const description =
    (front.has("description") ? asScalar(front.get("description") ?? "") : "") ||
    // when_to_use serves the same catalog line — a fallback, never an override.
    (front.has("when_to_use") ? asScalar(front.get("when_to_use") ?? "") : "");

  // The directory name is the identity in Claude Code; a lone file has only its
  // frontmatter — and failing that, its H1 is the closest thing to a title.
  const rawName = front.has("name") ? asScalar(front.get("name") ?? "") : "";
  const h1 = /^#\s+(.+)$/m.exec(body)?.[1] ?? "";
  const name = normalizeSkillName(rawName) ?? normalizeSkillName(h1) ?? undefined;

  const known = new Set(["name", "description", "site", "sites", "when_to_use"]);
  const ignoredKeys = [...front.keys()].filter((k) => !known.has(k));

  return {
    ...(name ? { name } : {}),
    ...(description ? { description } : {}),
    sites,
    body,
    ignoredKeys,
    droppedSites,
  };
}

/** The export form — round-trips through `parseSkillMd` (tested). */
export function serializeSkillMd(skill: Skill): string {
  const description = skill.description.replace(/\s*\n\s*/g, " ").trim();
  const front = [
    `name: ${skill.name}`,
    `description: ${description}`,
    ...(skill.sites?.length ? [`sites: [${skill.sites.join(", ")}]`] : []),
  ];
  return `---\n${front.join("\n")}\n---\n\n${skill.body.trim()}\n`;
}
