import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/Button";
import { Switch } from "@/components/Switch";
import { useStoredItem } from "@/components/useStoredItem";
import {
  getDoc,
  listMemory,
  memoryEnabled,
  removeMemory,
  watchDoc,
  type MemoryGroup,
} from "../documents";

/** The stored facts as displayable groups, kept live across background writes. */
function useMemoryGroups(): MemoryGroup[] {
  const [groups, setGroups] = useState<MemoryGroup[]>([]);
  useEffect(() => {
    let live = true;
    void getDoc("MEMORY.md").then((v) => live && setGroups(listMemory(v)));
    const unwatch = watchDoc("MEMORY.md", (v) => setGroups(listMemory(v)));
    return () => {
      live = false;
      unwatch();
    };
  }, []);
  return groups;
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
 * never reach the user. Facts tied to one site group under that site's name;
 * until any exist the list stays flat, label-free. Deleting is how a normal
 * user fixes a wrong memory.
 */
export function MemorySection() {
  const { t } = useTranslation();
  const enabled = useStoredItem(memoryEnabled);
  const groups = useMemoryGroups();
  const labeled = groups.some((g) => g.site);

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
        <p className="attention mt-3 rounded-lg px-3 py-2 text-xs text-neutral-700 dark:text-neutral-300">
          {t("memory.off")}
        </p>
      )}

      {/* Off + empty: the notice above is the whole state — an empty card
          promising future memories contradicts the toggle that just stopped
          them. */}
      {enabled && groups.length === 0 ? (
        <p className="mt-3 rounded-lg bg-neutral-50 px-3 py-3 text-xs text-neutral-500 dark:bg-neutral-900/50 dark:text-neutral-400">
          {t("memory.empty")}
        </p>
      ) : enabled ? (
        <div className="mt-3 space-y-3">
          {groups.map((group) => (
            <div key={group.site ?? ""}>
              {labeled && (
                <p className="mb-1.5 text-xs font-medium text-neutral-500 dark:text-neutral-400">
                  {group.site ?? t("memory.everySite")}
                </p>
              )}
              <ul className="space-y-1.5">
                {group.facts.map((fact) => (
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
                      onClick={() => void removeMemory(fact, group.site)}
                    >
                      <TrashIcon />
                    </Button>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      ) : null}
    </section>
  );
}
