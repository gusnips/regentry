import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useProvidersStore } from "./store";
import { ProviderIcon } from "./ProviderIcon";
import { AddProviderDialog } from "./AddProviderDialog";
import { listModels, pickLatestModel } from "../models";
import { PRESETS, providerDisplayName } from "../presets";
import { supportsUsage } from "../usage";
import { EFFORT_LABEL_KEYS, isEffort, REASONING_EFFORTS } from "../types";
import type { ModelInfo, ProviderConfig, ProviderShape } from "../types";
import { UsageIndicator } from "./UsageIndicator";
import { Select } from "@/components/Select";
import type { SelectOption } from "@/components/Select";
import { TextField } from "@/components/TextField";

/** Sentinel option value — opens the add-provider dialog instead of switching. */
const ADD_NEW = "__add__";

interface ModelsTarget {
  shape: ProviderShape;
  baseUrl: string;
  apiKey: string;
  /** Present on signed-in providers — listModels switches to OAuth-token mode headers. */
  auth?: ProviderConfig["auth"];
}

/**
 * Successful listings, cached per connection.
 * ponytail: session-long cache with no expiry — the chip row remounts every
 * time the history view opens and must not refetch identical params. The
 * ceiling is a stale list if the endpoint's models change mid-session;
 * upgrade path is a TTL or revalidating on focus.
 */
const modelsCache = new Map<string, ModelInfo[]>();

interface ModelsResult {
  key: string;
  models: ModelInfo[];
  error: string | null;
}

/** Fetches the endpoint's live model list; identity-keyed on the target. */
function useModels(target: ModelsTarget | null) {
  const key = target ? JSON.stringify(target) : null;
  const [fetched, setFetched] = useState<ModelsResult | null>(null);

  useEffect(() => {
    if (!key || !target || modelsCache.has(key)) return;
    let cancelled = false;
    listModels(target)
      .then((models) => {
        modelsCache.set(key, models);
        if (!cancelled) setFetched({ key, models, error: null });
      })
      .catch(
        (e: unknown) =>
          !cancelled &&
          setFetched({ key, models: [], error: e instanceof Error ? e.message : String(e) }),
      );
    return () => {
      cancelled = true;
    };
    // target identity is captured by key
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  // Cache hits resolve during render (a remounted or switched picker never
  // waits on a fetch it already paid for); errors are never cached, so a
  // failed listing retries on the next mount.
  const cached = key ? modelsCache.get(key) : undefined;
  const current: ModelsResult | null =
    key && fetched?.key === key
      ? fetched
      : key && cached
        ? { key, models: cached, error: null }
        : null;
  return {
    models: current?.models ?? [],
    loading: key !== null && current === null,
    error: current?.error ?? null,
  };
}

/** The active provider; the store's load is idempotent, so no guard here. */
function useActiveProvider() {
  const { providers, activeId, load } = useProvidersStore();
  useEffect(() => {
    void load();
  }, [load]);
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
        variant="quiet"
        className="shrink-0"
        iconOnlyTrigger
        ariaLabel={t("modelPicker.provider")}
        title={t("modelPicker.providerTitleFor", { name: providerDisplayName(active) })}
        value={active.id}
        onChange={(id) => (id === ADD_NEW ? setAddOpen(true) : void activate(id))}
        options={[
          ...providers.map((p) => {
            const preset = PRESETS.find((x) => x.id === p.id);
            return {
              value: p.id,
              label: providerDisplayName(p),
              icon: preset ? <ProviderIcon icon={preset.icon} size={14} /> : undefined,
            };
          }),
          { value: ADD_NEW, label: t("modelPicker.addProvider"), separatorBefore: true },
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
  // An OAuth provider stores no key; its access token is the bearer for listing too.
  const { models, loading, error } = useModels(
    active
      ? {
          shape: active.shape,
          baseUrl: active.baseUrl,
          apiKey: active.auth?.accessToken ?? active.apiKey,
          auth: active.auth,
        }
      : null,
  );

  // The extra "default" option means "don't send the knob at all".
  const effortOptions = [
    { value: "default", label: t("modelPicker.effort.default") },
    ...REASONING_EFFORTS.map((effort) => ({ value: effort, label: t(EFFORT_LABEL_KEYS[effort]) })),
  ];

  if (!active) return null;

  const preset = PRESETS.find((pr) => pr.id === active.id);
  // Live list wins; presets are the fallback for endpoints without a list route.
  const listed: ModelInfo[] =
    models.length > 0 ? models : (preset?.models.map((id) => ({ id })) ?? []);
  const autoTarget = pickLatestModel(models) ?? listed[0];

  // "Auto" shows what it will actually run, tagged so it stays distinguishable
  // from having pinned that same model by hand — the tag leads, because those
  // two rows carry the identical model name and a trailing chip reads too late
  // to tell them apart. The rule below it separates the mode from the values.
  const modelOptions: SelectOption[] = [
    autoTarget
      ? {
          value: "",
          label: autoTarget.name ?? autoTarget.id,
          hint: t("modelPicker.auto"),
          hintLeading: true,
        }
      : { value: "", label: t("modelPicker.auto") },
    ...listed.map((m, i) => ({
      value: m.id,
      label: m.name ?? m.id,
      separatorBefore: i === 0 && autoTarget !== undefined,
    })),
  ];
  // A persisted id the endpoint no longer lists (e.g. k3[1m]) stays selectable.
  if (active.model && !listed.some((m) => m.id === active.model)) {
    modelOptions.push({
      value: active.model,
      label: active.model,
      hint: t("modelPicker.notListed"),
      separatorBefore: true,
    });
  }
  // No list route and no preset data (custom endpoints) → free text.
  const freeText = !loading && listed.length === 0;
  // The label may be a display name ("Claude Sonnet 4.5") — the tooltip carries the wire id.
  const selectedId = active.model ?? autoTarget?.id;
  const modelTitle = selectedId
    ? t("modelPicker.modelTitleFor", { model: selectedId })
    : t("modelPicker.modelTitle");

  return (
    <div className="flex min-w-0 flex-1 items-center gap-1">
      {freeText ? (
        <TextField
          size="sm"
          aria-label={t("modelPicker.model")}
          title={error ? t("modelPicker.noModelListHint") : modelTitle}
          className="min-w-0 flex-1"
          value={active.model ?? ""}
          onChange={(e) => void update(active.id, { model: e.target.value || undefined })}
          placeholder={t("modelPicker.freeTextPlaceholder")}
        />
      ) : (
        <Select
          size="sm"
          variant="quiet"
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
        variant="quiet"
        className="shrink-0"
        ariaLabel={t("modelPicker.reasoningEffort")}
        title={t("modelPicker.effortHint")}
        value={active.reasoningEffort ?? "default"}
        onChange={(v) => void update(active.id, { reasoningEffort: isEffort(v) ? v : undefined })}
        options={effortOptions}
      />

      {supportsUsage(active.id) && <UsageIndicator provider={active} />}
    </div>
  );
}
