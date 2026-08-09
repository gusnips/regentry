import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/Button";
import { Switch } from "@/components/Switch";
import { useStoredItem } from "@/components/useStoredItem";
import { getDoc, listMemory, memoryEnabled, removeMemory, watchDoc } from "../documents";

/** The stored facts as displayable rows, kept live across background writes. */
function useMemoryList(): string[] {
  const [facts, setFacts] = useState<string[]>([]);
  useEffect(() => {
    let live = true;
    void getDoc("MEMORY.md").then((v) => live && setFacts(listMemory(v)));
    const unwatch = watchDoc("MEMORY.md", (v) => setFacts(listMemory(v)));
    return () => {
      live = false;
      unwatch();
    };
  }, []);
  return facts;
}

/** Small inline × — the project ships no icon library. */
function TrashIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M3 6h18" />
      <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" />
      <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
    </svg>
  );
}

/**
 * What TabRunner has learned, shown as a plain list — the file and its markdown
 * never reach the user. Deleting is how a normal user fixes a wrong memory.
 */
export function MemorySection() {
  const { t } = useTranslation();
  const enabled = useStoredItem(memoryEnabled);
  const facts = useMemoryList();

  return (
    <section className="mt-8">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-base font-semibold text-neutral-900 dark:text-neutral-100">
            {t("memory.title")}
          </h2>
          <p className="mt-1 text-xs text-neutral-500 dark:text-neutral-400">{t("memory.help")}</p>
        </div>
        <label className="flex shrink-0 items-center gap-2 pt-0.5 text-xs text-neutral-600 dark:text-neutral-300">
          {t("memory.enable")}
          <Switch
            checked={enabled}
            onChange={(v) => void memoryEnabled.set(v)}
            ariaLabel={t("memory.enable")}
          />
        </label>
      </div>

      {!enabled && (
        <p className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
          {t("memory.off")}
        </p>
      )}

      {facts.length === 0 ? (
        <p className="mt-3 rounded-lg bg-neutral-50 px-3 py-3 text-xs text-neutral-500 dark:bg-neutral-900/50 dark:text-neutral-400">
          {t("memory.empty")}
        </p>
      ) : (
        <ul className="mt-3 space-y-1.5">
          {facts.map((fact) => (
            <li
              key={fact}
              className="flex items-start justify-between gap-3 rounded-lg bg-neutral-50 px-3 py-2 dark:bg-neutral-900/50"
            >
              <span className="min-w-0 flex-1 text-sm leading-relaxed text-neutral-800 dark:text-neutral-200">
                {fact}
              </span>
              <Button
                variant="ghost-danger"
                size="sm"
                className="shrink-0"
                aria-label={t("memory.deleteMemory")}
                onClick={() => void removeMemory(fact)}
              >
                <TrashIcon />
              </Button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
