import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/Button";
import { Switch } from "@/components/Switch";
import { TextArea } from "@/components/TextArea";
import { SegmentedControl } from "@/components/SegmentedControl";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { useStoredItem } from "@/components/useStoredItem";
import { DOC_NAMES, getDoc, setDoc, watchDoc, memoryEnabled } from "../documents";
import type { DocName } from "../documents";

/** Long enough that a save feels instant, short enough to survive a closed tab. */
const SAVE_DEBOUNCE_MS = 500;
const SAVED_BADGE_MS = 1_600;

function useStoredDoc(name: DocName) {
  const [text, setText] = useState("");
  const [saved, setSaved] = useState(false);
  const ref = useRef<HTMLTextAreaElement>(null);

  // Reload on doc switch, and follow background writes — but never while the
  // user is typing into this field, or a mid-run `remember` would eat their edit.
  useEffect(() => {
    let live = true;
    void getDoc(name).then((v) => live && setText(v));
    const unwatch = watchDoc(name, (v) => {
      if (live && document.activeElement !== ref.current) setText(v);
    });
    return () => {
      live = false;
      unwatch();
    };
  }, [name]);

  const write = (value: string) => {
    setText(value);
    void setDoc(name, value).then(() => {
      setSaved(true);
      setTimeout(() => setSaved(false), SAVED_BADGE_MS);
    });
  };

  // Debounced so a burst of keystrokes is one storage write, not thirty.
  const edit = (value: string) => {
    setText(value);
    clearTimeout(timers.get(name));
    timers.set(
      name,
      window.setTimeout(() => write(value), SAVE_DEBOUNCE_MS),
    );
  };

  return { text, saved, ref, edit, write };
}

const timers = new Map<DocName, number>();

function download(name: string, content: string) {
  const url = URL.createObjectURL(new Blob([content], { type: "text/markdown" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

/**
 * One markdown document, edited as a file. Autosaves — an explicit Save button
 * on a scratchpad you leave half-written is a trap, not a safeguard.
 */
function DocEditor({ name, inert }: { name: DocName; inert: boolean }) {
  const { t } = useTranslation();
  const { text, saved, ref, edit, write } = useStoredDoc(name);
  const importRef = useRef<HTMLInputElement>(null);
  const isMemory = name === "MEMORY.md";

  return (
    <div className="mt-3">
      <p className="text-xs text-neutral-500 dark:text-neutral-400">
        {t(isMemory ? "memory.memoryHelp" : "memory.instructionsHelp")}
      </p>

      <TextArea
        ref={ref}
        value={text}
        disabled={inert}
        onChange={(e) => edit(e.target.value)}
        rows={10}
        spellCheck={false}
        aria-label={name}
        placeholder={t(isMemory ? "memory.memoryPlaceholder" : "memory.instructionsPlaceholder")}
        className="mt-2 w-full resize-y bg-white font-mono text-xs leading-relaxed text-neutral-800 disabled:bg-neutral-50 dark:bg-neutral-900 dark:text-neutral-200 dark:disabled:bg-neutral-900/50"
      />

      <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
        <span className="text-xs text-neutral-400 dark:text-neutral-500">
          {saved ? t("memory.saved") : t("memory.chars", { count: text.length })}
        </span>
        <div className="flex items-center gap-1">
          <input
            ref={importRef}
            type="file"
            accept=".md,.txt,text/markdown,text/plain"
            className="hidden"
            onChange={async (e) => {
              const file = e.target.files?.[0];
              // Reset first: picking the same file twice must still fire onChange.
              e.target.value = "";
              if (file) write(await file.text());
            }}
          />
          <Button variant="ghost" size="sm" onClick={() => importRef.current?.click()}>
            {t("memory.import")}
          </Button>
          <Button variant="ghost" size="sm" disabled={!text} onClick={() => download(name, text)}>
            {t("memory.export")}
          </Button>
          <ConfirmDialog
            trigger={
              <Button variant="ghost-danger" size="sm" disabled={!text}>
                {t("memory.clear")}
              </Button>
            }
            title={t("memory.clearTitle", { name })}
            description={t("memory.clearBody")}
            confirmLabel={t("memory.clear")}
            onConfirm={() => write("")}
          />
        </div>
      </div>
    </div>
  );
}

/**
 * The agent's two documents, presented as the files they model. Tabs rather
 * than two stacked editors: they are read the same way but written by different
 * people — you own AGENTS.md, Regent owns MEMORY.md — and only one is ever
 * being edited at a time.
 */
export function MemorySection() {
  const { t } = useTranslation();
  const [active, setActive] = useState<DocName>("AGENTS.md");
  const enabled = useStoredItem(memoryEnabled);

  const inert = active === "MEMORY.md" && !enabled;

  return (
    <section className="mt-8">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-base font-semibold text-neutral-900 dark:text-neutral-100">
            {t("memory.title")}
          </h2>
          <p className="mt-1 text-xs text-neutral-500 dark:text-neutral-400">
            {t("memory.subtitle")}
          </p>
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

      <div className="mt-4">
        <SegmentedControl
          value={active}
          onChange={setActive}
          ariaLabel={t("memory.fileTabs")}
          options={DOC_NAMES.map((name) => ({
            value: name,
            label: <span className="font-mono">{name}</span>,
          }))}
        />
      </div>

      {inert && (
        <p className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
          {t("memory.offNotice")}
        </p>
      )}

      <DocEditor key={active} name={active} inert={inert} />
    </section>
  );
}
