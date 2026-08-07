import { describe, it, expect } from "vitest";
import en from "../locales/en.json";
import ptBR from "../locales/pt-BR.json";
import es from "../locales/es.json";

type Catalog = { [key: string]: unknown };

const LOCALES: Record<string, Catalog> = { en, "pt-BR": ptBR, es };

/** Flatten to dot keys; arrays (returnObjects) flatten by index. */
function flatten(obj: Catalog, prefix = ""): Map<string, string> {
  const out = new Map<string, string>();
  for (const [k, v] of Object.entries(obj)) {
    const full = prefix ? `${prefix}.${k}` : k;
    if (typeof v === "string") out.set(full, v);
    else if (v && typeof v === "object") {
      for (const [fk, fv] of flatten(v as Catalog, full)) out.set(fk, fv);
    }
  }
  return out;
}

function placeholders(s: string): string[] {
  return [...s.matchAll(/\{\{(\w+)\}\}/g)].map((m) => m[1]!).sort();
}

describe("locale catalogs", () => {
  const flat = Object.fromEntries(Object.entries(LOCALES).map(([l, c]) => [l, flatten(c)]));

  it("have identical key sets", () => {
    const union = new Set(Object.values(flat).flatMap((m) => [...m.keys()]));
    for (const [loc, m] of Object.entries(flat)) {
      const missing = [...union].filter((k) => !m.has(k));
      expect(missing, `${loc} is missing keys`).toEqual([]);
    }
  });

  it("have no empty values", () => {
    for (const [loc, m] of Object.entries(flat)) {
      for (const [k, v] of m) expect(v.trim(), `${loc}:${k} is empty`).not.toBe("");
    }
  });

  it("use the same {{placeholders}} per key", () => {
    for (const [k, enValue] of flat.en!) {
      for (const loc of ["pt-BR", "es"] as const) {
        const other = flat[loc]!.get(k);
        if (other === undefined) continue; // covered by the key-set test
        expect(placeholders(other), `${loc}:${k} placeholders`).toEqual(placeholders(enValue));
      }
    }
  });
});
