import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/Button";
import { TextField } from "@/components/TextField";
import { TextArea } from "@/components/TextArea";
import { FieldShell } from "@/components/FieldShell";
import { normalizeHost } from "@/modules/memory";
import { truncateTo } from "@/lib/format";
import { MAX_BODY_CHARS, MAX_DESCRIPTION_CHARS, normalizeSkillName } from "../types";
import { saveSkill } from "../store";
import { useSkillsList } from "./hooks";

/** Prefill for the form — a full skill (edit), a parsed import, or a distilled draft. */
export interface SkillSeed {
  /** Present = editing this stored skill; absent = creating. */
  id?: string;
  name?: string;
  description?: string;
  sites?: string[];
  body?: string;
  source?: { url: string };
}

/**
 * The one skill editor — the options New/Edit dialog, the import preview, and
 * the conversation-draft review all render this, so every path to a saved
 * skill passes the same fields and the same store rules.
 */
export function SkillForm({
  seed,
  replaceOnCollision = false,
  onSaved,
  onCancel,
}: {
  seed?: SkillSeed;
  /** Import re-runs replace the same-named skill; hand edits never do (a typo must not overwrite). */
  replaceOnCollision?: boolean;
  onSaved: () => void;
  onCancel: () => void;
}) {
  const { t } = useTranslation();
  const skills = useSkillsList();
  const [nameText, setNameText] = useState(seed?.name ?? "");
  const [description, setDescription] = useState(seed?.description ?? "");
  const [sitesText, setSitesText] = useState(seed?.sites?.join(", ") ?? "");
  const [body, setBody] = useState(seed?.body ?? "");
  const [error, setError] = useState<string | null>(null);

  // Live, so the "replaces your existing X" warning shows before Save is hit.
  const liveName = normalizeSkillName(nameText);
  const collision = liveName
    ? skills.find((s) => s.name === liveName && s.id !== seed?.id)
    : undefined;

  const save = async () => {
    const name = normalizeSkillName(nameText);
    if (!name) {
      setError(t("skills.errors.badName"));
      return;
    }
    const entries = sitesText.split(/[,\s]+/).filter(Boolean);
    const sites: string[] = [];
    const bad: string[] = [];
    for (const entry of entries) {
      const host = normalizeHost(entry);
      if (!host) bad.push(entry);
      else if (!sites.includes(host)) sites.push(host);
    }
    if (bad.length > 0) {
      setError(t("skills.form.sitesInvalid", { list: bad.join(", ") }));
      return;
    }
    // Editing keeps its record; a sanctioned collision (re-import) takes over
    // the existing one — same id, so enabled state and createdAt survive
    // (the store owns the timestamps).
    const base =
      skills.find((s) => s.id === seed?.id) ?? (replaceOnCollision ? collision : undefined);
    const source = seed?.source ?? base?.source;
    const result = await saveSkill({
      id: base?.id ?? crypto.randomUUID(),
      name,
      description: description.trim(),
      ...(sites.length > 0 ? { sites } : {}),
      body: body.trim(),
      enabled: base?.enabled ?? true,
      ...(source ? { source } : {}),
    });
    if (!result.ok) {
      setError(result.error);
      return;
    }
    onSaved();
  };

  return (
    <div className="flex flex-col gap-3">
      <TextField
        label={t("skills.form.name")}
        hint={t("skills.form.nameHint")}
        value={nameText}
        maxLength={64}
        placeholder="invoice-download"
        onChange={(e) => setNameText(e.target.value)}
      />
      <FieldShell label={t("skills.form.description")} hint={t("skills.form.descriptionHint")}>
        <TextArea
          rows={2}
          value={description}
          maxLength={MAX_DESCRIPTION_CHARS}
          placeholder={t("skills.form.descriptionPlaceholder")}
          onChange={(e) => setDescription(e.target.value)}
        />
      </FieldShell>
      <TextField
        label={t("skills.form.sites")}
        hint={t("skills.form.sitesHint")}
        value={sitesText}
        placeholder="acme.com, mail.google.com"
        onChange={(e) => setSitesText(e.target.value)}
      />
      <FieldShell label={t("skills.form.body")}>
        <TextArea
          rows={8}
          value={body}
          maxLength={MAX_BODY_CHARS}
          placeholder={t("skills.form.bodyPlaceholder")}
          onChange={(e) => setBody(e.target.value)}
        />
      </FieldShell>

      {seed?.source && (
        <p className="text-xs text-neutral-500 dark:text-neutral-400">
          {t("skills.form.source", { url: truncateTo(seed.source.url, 80) })}
        </p>
      )}
      {replaceOnCollision && collision && (
        <p className="attention rounded-lg px-3 py-2 text-xs text-neutral-700 dark:text-neutral-300">
          {t("skills.form.replaces", { name: collision.name })}
        </p>
      )}
      {error && <p className="text-xs text-red-600 dark:text-red-400">{error}</p>}

      <div className="flex justify-end gap-2">
        <Button variant="ghost" onClick={onCancel}>
          {t("common.cancel")}
        </Button>
        <Button onClick={() => void save()}>{t("skills.form.save")}</Button>
      </div>
    </div>
  );
}
