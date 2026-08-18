import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { TitledDialog } from "@/components/TitledDialog";
import { Button } from "@/components/Button";
import { TextField } from "@/components/TextField";
import { TextArea } from "@/components/TextArea";
import { parseSkillMd, type ParsedSkillMd } from "../skill-md";
import { fetchSkillMarkdown, resolveSkillSource } from "../import-url";
import { seedFromParsed, SkillForm } from "./SkillForm";

type Stage =
  | { kind: "input" }
  | { kind: "fetching" }
  | { kind: "review"; parsed: ParsedSkillMd; sourceUrl?: string };

/**
 * The dialog's inside, mounted only while it is open (DraftBody's rule) —
 * mounting IS the reset, so closing mid-fetch can't leak that fetch's result
 * into the next open as a review stage nobody asked for. Unmount also aborts
 * the transfer itself.
 */
function ImportBody({ onDone }: { onDone: () => void }) {
  const { t } = useTranslation();
  const [stage, setStage] = useState<Stage>({ kind: "input" });
  const [pasting, setPasting] = useState(false);
  const [input, setInput] = useState("");
  const [pasted, setPasted] = useState("");
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => () => abortRef.current?.abort(), []);

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
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      const text = await fetchSkillMarkdown(source.url, controller.signal);
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
          seed={seedFromParsed(stage.parsed, stage.sourceUrl)}
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
    <TitledDialog
      open={open}
      onOpenChange={(next) => !next && onClose()}
      title={t("skills.import.title")}
      description={t("skills.import.description")}
      widthClass="w-[min(30rem,calc(100vw-2rem))]"
    >
      {open && <ImportBody onDone={onClose} />}
    </TitledDialog>
  );
}
