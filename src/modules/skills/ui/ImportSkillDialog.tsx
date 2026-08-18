import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Dialog } from "@base-ui-components/react";
import { XIcon } from "@/components/Icon";
import { overlayCard, scrim } from "@/components/chrome";
import { Button } from "@/components/Button";
import { TextField } from "@/components/TextField";
import { TextArea } from "@/components/TextArea";
import { parseSkillMd, type ParsedSkillMd } from "../skill-md";
import { fetchSkillMarkdown, resolveSkillSource } from "../import-url";
import { SkillForm, type SkillSeed } from "./SkillForm";

type Stage =
  | { kind: "input" }
  | { kind: "fetching" }
  | { kind: "review"; parsed: ParsedSkillMd; sourceUrl?: string };

/**
 * The dialog's inside, mounted only while it is open (DraftBody's rule) —
 * mounting IS the reset, so closing mid-fetch can't leak that fetch's result
 * into the next open as a review stage nobody asked for.
 */
function ImportBody({ onDone }: { onDone: () => void }) {
  const { t } = useTranslation();
  const [stage, setStage] = useState<Stage>({ kind: "input" });
  const [pasting, setPasting] = useState(false);
  const [input, setInput] = useState("");
  const [pasted, setPasted] = useState("");
  const [error, setError] = useState<string | null>(null);

  const fetchIt = async () => {
    if (stage.kind !== "input") return; // Enter while a fetch is in flight
    setError(null);
    const source = resolveSkillSource(input);
    if (!source.ok) {
      setError(
        t(source.reason === "http" ? "skills.import.errorHttp" : "skills.import.errorUnparseable"),
      );
      return;
    }
    setStage({ kind: "fetching" });
    try {
      const text = await fetchSkillMarkdown(source.url);
      setStage({ kind: "review", parsed: parseSkillMd(text), sourceUrl: source.url });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setStage({ kind: "input" });
    }
  };

  const previewPaste = () => {
    setError(null);
    if (!pasted.trim()) {
      setError(t("skills.import.errorNothingPasted"));
      return;
    }
    setStage({ kind: "review", parsed: parseSkillMd(pasted) });
  };

  if (stage.kind === "review") {
    const seed: SkillSeed = {
      ...(stage.parsed.name ? { name: stage.parsed.name } : {}),
      ...(stage.parsed.description ? { description: stage.parsed.description } : {}),
      sites: stage.parsed.sites,
      body: stage.parsed.body,
      ...(stage.sourceUrl ? { source: { url: stage.sourceUrl } } : {}),
    };
    return (
      <div className="flex flex-col gap-3">
        <p className="attention rounded-lg px-3 py-2 text-xs text-neutral-700 dark:text-neutral-300">
          {t("skills.import.review")}
        </p>
        {stage.parsed.ignoredKeys.length > 0 && (
          <p className="text-xs text-neutral-500 dark:text-neutral-400">
            {t("skills.import.ignored", { list: stage.parsed.ignoredKeys.join(", ") })}
          </p>
        )}
        {stage.parsed.droppedSites.length > 0 && (
          <p className="text-xs text-neutral-500 dark:text-neutral-400">
            {t("skills.import.droppedSites", { list: stage.parsed.droppedSites.join(", ") })}
          </p>
        )}
        <SkillForm
          seed={seed}
          replaceOnCollision
          onSaved={onDone}
          onCancel={() => setStage({ kind: "input" })}
        />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {pasting ? (
        <TextArea
          rows={8}
          value={pasted}
          placeholder={t("skills.import.pastePlaceholder")}
          onChange={(e) => setPasted(e.target.value)}
        />
      ) : (
        <TextField
          label={t("skills.import.url")}
          hint={t("skills.import.urlHint")}
          value={input}
          placeholder="https://… or owner/repo"
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") void fetchIt();
          }}
        />
      )}
      {error && <p className="text-xs text-red-600 dark:text-red-400">{error}</p>}
      <div className="flex items-center justify-between gap-2">
        <button
          type="button"
          className="cursor-pointer text-xs text-neutral-500 underline-offset-2 hover:underline dark:text-neutral-400"
          onClick={() => {
            setPasting((v) => !v);
            setError(null);
          }}
        >
          {t(pasting ? "skills.import.modeUrl" : "skills.import.modePaste")}
        </button>
        {pasting ? (
          <Button onClick={previewPaste}>{t("skills.import.preview")}</Button>
        ) : (
          <Button disabled={stage.kind === "fetching"} onClick={() => void fetchIt()}>
            {t(stage.kind === "fetching" ? "skills.import.fetching" : "skills.import.fetch")}
          </Button>
        )}
      </div>
    </div>
  );
}

/**
 * Import a skill from a URL, a GitHub `owner/repo` shorthand, or pasted
 * markdown. The review stage is the consent gate: an imported body is
 * untrusted prose that will ride the system prompt on matching runs, so the
 * whole of it sits in an editable form before anything is stored. The fetch
 * runs right here in the page (the `/usage` precedent) — user-initiated, one
 * URL, never from the worker.
 */
export function ImportSkillDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = useTranslation();
  return (
    <Dialog.Root open={open} onOpenChange={(next) => !next && onClose()}>
      <Dialog.Portal>
        <Dialog.Backdrop className={scrim} />
        <Dialog.Popup
          className={`fixed top-1/2 left-1/2 z-50 max-h-[90vh] w-[min(30rem,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 overflow-y-auto p-4 ${overlayCard}`}
        >
          <div className="flex items-start justify-between gap-2">
            <div>
              <Dialog.Title className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">
                {t("skills.import.title")}
              </Dialog.Title>
              <Dialog.Description className="mt-0.5 text-xs text-neutral-500 dark:text-neutral-400">
                {t("skills.import.description")}
              </Dialog.Description>
            </div>
            <Dialog.Close
              aria-label={t("common.close")}
              className="rounded-md p-1 text-neutral-400 hover:bg-neutral-100 hover:text-neutral-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 dark:text-neutral-500 dark:hover:bg-neutral-800 dark:hover:text-neutral-300"
            >
              <XIcon />
            </Dialog.Close>
          </div>
          <div className="mt-3">{open && <ImportBody onDone={onClose} />}</div>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
