import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useProvidersStore } from "./store";
import { ProviderIcon } from "./ProviderIcon";
import { AddProviderDialog } from "./AddProviderDialog";
import { listModels, pickLatestModel } from "../models";
import { PRESETS } from "../presets";
import type { ModelInfo, ProviderShape, ReasoningEffort } from "../types";
import { Select } from "@/components/Select";
import { TextField } from "@/components/TextField";

/** Sentinel option value — opens the add-provider dialog instead of switching. */
const ADD_NEW = "__add__";

interface ModelsTarget {
  shape: ProviderShape;
  baseUrl: string;
  apiKey: string;
}

/** Fetches the endpoint's live model list; identity-keyed on the target. */
function useModels(target: ModelsTarget | null) {
  const key = target ? JSON.stringify(target) : null;
  const [result, setResult] = useState<{
    key: string;
    models: ModelInfo[];
    error: string | null;
  } | null>(null);

  useEffect(() => {
    if (!key || !target) return;
    let cancelled = false;
    listModels(target)
      .then((models) => !cancelled && setResult({ key, models, error: null }))
      .catch(
        (e: unknown) =>
          !cancelled &&
          setResult({ key, models: [], error: e instanceof Error ? e.message : String(e) }),
      );
    return () => {
      cancelled = true;
    };
    // target identity is captured by key
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  const current = key && result?.key === key ? result : null;
  return {
    models: current?.models ?? [],
    loading: key !== null && current === null,
    error: current?.error ?? null,
  };
}

/** The active provider, with the store loaded on first mount. */
function useActiveProvider() {
  const { providers, activeId, loaded, load } = useProvidersStore();
  useEffect(() => {
    if (!loaded) void load();
  }, [loaded, load]);
  return providers.find((p) => p.id === activeId) ?? providers[0];
}

/**
 * Provider switcher for the panel header — sits next to the brand mark. The
 * last option opens the add-provider dialog, so a new endpoint never requires
 * a trip to the options page.
 */
export function ProviderSelect() {
  const { t } = useTranslation();
  const { providers, activate } = useProvidersStore();
  const active = useActiveProvider();
  const [addOpen, setAddOpen] = useState(false);

  // With zero providers the side panel shows Onboarding instead.
  if (!active) return null;

  return (
    <>
      <Select
        size="sm"
        className="min-w-0 flex-1"
        ariaLabel={t("modelPicker.provider")}
        title={t("modelPicker.providerTitle")}
        value={active.id}
        onChange={(id) => (id === ADD_NEW ? setAddOpen(true) : void activate(id))}
        options={[
          ...providers.map((p) => {
            const pr = PRESETS.find((x) => x.id === p.id);
            return {
              value: p.id,
              label: p.name,
              icon: pr ? <ProviderIcon icon={pr.icon} size={14} /> : undefined,
            };
          }),
          { value: ADD_NEW, label: t("modelPicker.addProvider") },
        ]}
      />
      <AddProviderDialog open={addOpen} onOpenChange={setAddOpen} />
    </>
  );
}

/**
 * Per-task model + reasoning effort, as bare selects (the values name
 * themselves — no labels needed at this density). Choices persist onto the
 * provider's stored config; the background snapshots it at run start, so
 * edits apply to the next task, never a run in flight.
 */
export function ModelControls() {
  const { t } = useTranslation();
  const update = useProvidersStore((s) => s.update);
  const active = useActiveProvider();
  // Only the connection fields key the fetch — changing model/effort must not refetch.
  const { models, loading, error } = useModels(
    active ? { shape: active.shape, baseUrl: active.baseUrl, apiKey: active.apiKey } : null,
  );

  const effortOptions = [
    { value: "default", label: t("modelPicker.effort.default") },
    { value: "none", label: t("modelPicker.effort.none") },
    { value: "low", label: t("modelPicker.effort.low") },
    { value: "medium", label: t("modelPicker.effort.medium") },
    { value: "high", label: t("modelPicker.effort.high") },
    { value: "max", label: t("modelPicker.effort.max") },
  ];

  if (!active) return null;

  const preset = PRESETS.find((pr) => pr.id === active.id);
  const listedIds = models.length > 0 ? models.map((m) => m.id) : (preset?.models ?? []);
  const autoTarget = pickLatestModel(models)?.id ?? preset?.models[0];

  const modelOptions = [
    { value: "", label: t("modelPicker.auto") },
    ...listedIds.map((id) => ({ value: id, label: id })),
  ];
  // A persisted id the endpoint no longer lists (e.g. k3[1m]) stays selectable.
  if (active.model && !listedIds.includes(active.model)) {
    modelOptions.push({
      value: active.model,
      label: t("modelPicker.current", { model: active.model }),
    });
  }
  // No list route and no preset data (custom endpoints) → free text.
  const freeText = !loading && listedIds.length === 0;
  // What "Auto" resolves to belongs in the tooltip, not the option label.
  const modelTitle = active.model
    ? t("modelPicker.modelTitle")
    : loading
      ? t("modelPicker.autoLoading")
      : autoTarget
        ? t("modelPicker.autoLatest", { model: autoTarget })
        : t("modelPicker.modelTitle");

  return (
    <div className="flex items-center gap-2 pb-2">
      {freeText ? (
        <TextField
          aria-label={t("modelPicker.model")}
          title={error ? t("modelPicker.noModelListHint") : modelTitle}
          className="min-w-0 flex-1 rounded-lg border border-neutral-300 px-2 py-1 text-xs placeholder:text-neutral-400 focus:border-brand-500 focus:outline-none dark:border-neutral-600 dark:placeholder:text-neutral-500"
          value={active.model ?? ""}
          onChange={(e) => void update(active.id, { model: e.target.value || undefined })}
          placeholder={t("modelPicker.freeTextPlaceholder")}
        />
      ) : (
        <Select
          size="sm"
          className="min-w-0 flex-1"
          ariaLabel={t("modelPicker.model")}
          title={modelTitle}
          value={active.model ?? ""}
          onChange={(v) => void update(active.id, { model: v || undefined })}
          options={modelOptions}
        />
      )}

      <Select
        size="sm"
        className="w-28 shrink-0"
        ariaLabel={t("modelPicker.reasoningEffort")}
        title={t("modelPicker.effortHint")}
        value={active.reasoningEffort ?? "default"}
        onChange={(v) =>
          void update(active.id, {
            reasoningEffort: v === "default" ? undefined : (v as ReasoningEffort),
          })
        }
        options={effortOptions}
      />
    </div>
  );
}
