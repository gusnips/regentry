import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useProvidersStore, activeProviderOf } from "./store";
import { engineLabel } from "./engine-label";
import { ProviderIcon } from "./ProviderIcon";
import { AddProviderDialog } from "./AddProviderDialog";
import { UsageSection } from "./UsageSection";
import {
  knownModels,
  listModels,
  modelsTarget,
  pickLatestModel,
  readModelsCache,
  writeModelsCache,
} from "../models";
import type { ModelsTarget } from "../models";
import { PRESETS, providerDisplayName } from "../presets";
import { supportsUsage } from "../usage";
import { EFFORT_LABEL_KEYS, isEffort, REASONING_EFFORTS } from "../types";
import type { ModelInfo, ProviderConfig } from "../types";
import { Popover } from "@/components/Popover";
import { Select } from "@/components/Select";
import { TextField } from "@/components/TextField";
import { Button } from "@/components/Button";
import { CheckIcon, ChevronDownIcon } from "@/components/Icon";

/**
 * The engine picker — provider, model, and reasoning effort behind one quiet
 * chip in the composer footer (the layout every agent harness converged on:
 * the control sits where the task is typed, and effort folds into the model
 * picker rather than living as a peer select). Choices persist onto the
 * provider's stored config; the background snapshots it at run start, so
 * edits apply to the next task, never a run in flight.
 *
 * The popover's sections: models grouped by provider (picking a model under
 * another provider IS the provider switch; a group's header activates without
 * re-pinning), one effort row for the active provider, then the rare-but-real
 * utilities — subscription usage and adding a provider — that used to cost
 * their own header chrome.
 */

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
    if (!key || !target || readModelsCache(target)) return;
    let cancelled = false;
    listModels(target)
      .then((models) => {
        writeModelsCache(target, models);
        if (!cancelled) setFetched({ key, models, error: null });
      })
      .catch(
        (e: unknown) =>
          !cancelled &&
          setFetched({ key, models: [], error: e instanceof Error ? e.message : String(e) }),
      );
    return () => {
      cancelled = false;
    };
    // target identity is captured by key
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  // Cache hits resolve during render (a remounted or switched picker never
  // waits on a fetch it already paid for); errors are never cached, so a
  // failed listing retries on the next mount.
  const cached = target ? readModelsCache(target) : undefined;
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
  const load = useProvidersStore((s) => s.load);
  useEffect(() => {
    void load();
  }, [load]);
  return useProvidersStore(activeProviderOf);
}

function Row({
  selected,
  onClick,
  title,
  children,
}: {
  selected?: boolean;
  onClick: () => void;
  title?: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      className="flex w-full cursor-pointer items-center gap-1.5 rounded-md px-1.5 py-1 text-left text-xs text-neutral-700 hover:bg-neutral-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 dark:text-neutral-300 dark:hover:bg-neutral-800"
    >
      <span className="flex w-3.5 shrink-0 justify-center text-brand-600 dark:text-brand-400">
        {selected && <CheckIcon size={12} />}
      </span>
      {children}
    </button>
  );
}

/**
 * One provider's section: its live model list (session-cached, fetched on
 * first open), or the free-text field when the endpoint has no list route.
 * The header activates the provider without touching its stored choices —
 * the rows are the re-pinning gesture.
 */
function ProviderGroup({
  provider,
  isActive,
  onActivate,
  onPick,
}: {
  provider: ProviderConfig;
  isActive: boolean;
  onActivate: () => void;
  onPick: (model: string | undefined) => void;
}) {
  const { t } = useTranslation();
  const { models, loading, error } = useModels(modelsTarget(provider));
  const preset = PRESETS.find((pr) => pr.id === provider.id);
  // Live list wins; presets are the fallback for endpoints without a list route.
  const listed: ModelInfo[] =
    models.length > 0 ? models : (preset?.models.map((id) => ({ id })) ?? []);
  const autoTarget = pickLatestModel(models) ?? listed[0];
  const freeText = !loading && listed.length === 0;

  const header = (
    <>
      {preset && <ProviderIcon icon={preset.icon} size={12} />}
      <span className="min-w-0 truncate">{providerDisplayName(provider)}</span>
      {isActive && (
        <span className="ml-auto shrink-0 rounded bg-brand-50 px-1 py-px text-[10px] font-medium text-brand-700 dark:bg-brand-950/60 dark:text-brand-300">
          {t("enginePicker.current")}
        </span>
      )}
    </>
  );

  return (
    <div className="flex flex-col">
      {isActive ? (
        <div className="flex items-center gap-1.5 px-1.5 pb-0.5 pt-1 text-[11px] font-semibold uppercase tracking-wide text-neutral-400 dark:text-neutral-500">
          {header}
        </div>
      ) : (
        <button
          type="button"
          onClick={onActivate}
          title={t("enginePicker.useProviderTitle")}
          className="flex w-full cursor-pointer items-center gap-1.5 rounded-md px-1.5 pb-0.5 pt-1 text-left text-[11px] font-semibold uppercase tracking-wide text-neutral-400 hover:bg-neutral-100 hover:text-neutral-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 dark:text-neutral-500 dark:hover:bg-neutral-800 dark:hover:text-neutral-300"
        >
          {header}
        </button>
      )}

      {loading && (
        <div className="px-2 py-1 text-xs text-neutral-400 dark:text-neutral-500">
          {t("enginePicker.loadingModels")}
        </div>
      )}

      {freeText ? (
        isActive && (
          <TextField
            size="sm"
            aria-label={t("modelPicker.model")}
            title={error ? t("modelPicker.noModelListHint") : undefined}
            className="mx-1.5 mt-0.5"
            value={provider.model ?? ""}
            onChange={(e) => onPick(e.target.value || undefined)}
            placeholder={t("modelPicker.freeTextPlaceholder")}
          />
        )
      ) : (
        <>
          {/* Auto leads and shows what it will actually run, tagged so it stays
              distinguishable from having pinned that same model by hand. */}
          {autoTarget && (
            <Row
              selected={isActive && provider.model === undefined}
              onClick={() => onPick(undefined)}
              title={autoTarget.id}
            >
              <span className="shrink-0 rounded bg-neutral-100 px-1 py-px text-[10px] font-medium text-neutral-500 dark:bg-neutral-800 dark:text-neutral-400">
                {t("modelPicker.auto")}
              </span>
              <span className="min-w-0 truncate">{autoTarget.name ?? autoTarget.id}</span>
            </Row>
          )}
          {listed.map((m) => (
            <Row
              key={m.id}
              selected={isActive && provider.model === m.id}
              onClick={() => onPick(m.id)}
              title={m.id}
            >
              <span className="min-w-0 truncate">{m.name ?? m.id}</span>
            </Row>
          ))}
          {/* A persisted id the endpoint no longer lists stays selectable. */}
          {isActive && provider.model && !listed.some((m) => m.id === provider.model) && (
            <Row
              selected
              onClick={() => onPick(provider.model)}
              title={t("modelPicker.notListed")}
            >
              <span className="min-w-0 truncate">{provider.model}</span>
              <span className="ml-auto shrink-0 text-[10px] text-neutral-400 dark:text-neutral-500">
                {t("modelPicker.notListed")}
              </span>
            </Row>
          )}
        </>
      )}
    </div>
  );
}

export function EnginePicker() {
  const { t } = useTranslation();
  const { providers, activate, update } = useProvidersStore();
  const active = useActiveProvider();
  const [open, setOpen] = useState(false);
  const [addOpen, setAddOpen] = useState(false);

  // With zero providers the side panel shows Onboarding instead.
  if (!active) return null;

  // The trigger's label reads the session-cached/preset list synchronously —
  // the popover's live fetch must not be the price of painting the composer.
  const known = knownModels(active);
  const autoTarget = pickLatestModel(known);
  const label = engineLabel({
    auto: active.model === undefined,
    modelName: active.model
      ? (known.find((m) => m.id === active.model)?.name ?? active.model)
      : (autoTarget?.name ?? autoTarget?.id),
    autoText: t("modelPicker.auto"),
    ...(active.reasoningEffort
      ? { effortLabel: t(EFFORT_LABEL_KEYS[active.reasoningEffort]) }
      : {}),
  });

  // Picking a model under another provider IS the provider switch — one click,
  // both choices. The group header's activate-only path keeps a pinned model.
  const pick = (p: ProviderConfig, model: string | undefined) => {
    if (p.id !== active.id) void activate(p.id);
    void update(p.id, { model });
    setOpen(false);
  };

  // The extra "default" option means "don't send the knob at all".
  const effortOptions = [
    { value: "default", label: t("modelPicker.effort.default") },
    ...REASONING_EFFORTS.map((effort) => ({ value: effort, label: t(EFFORT_LABEL_KEYS[effort]) })),
  ];

  const preset = PRESETS.find((pr) => pr.id === active.id);

  return (
    <>
      <Popover
        open={open}
        onOpenChange={setOpen}
        className="max-h-[70vh] w-72 overflow-y-auto"
        trigger={
          <Button
            variant="ghost"
            size="sm"
            aria-label={t("enginePicker.triggerTitle", { label })}
            title={t("enginePicker.triggerTitle", { label })}
            className="flex min-w-0 shrink items-center gap-1.5 hover:text-neutral-900 dark:hover:text-neutral-100"
          >
            {preset && <ProviderIcon icon={preset.icon} size={14} />}
            <span className="truncate">{label}</span>
            <ChevronDownIcon size={12} className="shrink-0 text-neutral-400" />
          </Button>
        }
      >
        <div className="flex flex-col gap-0.5">
          {providers.map((p, i) => (
            <div
              key={p.id}
              className={i > 0 ? "mt-1 border-t border-neutral-100 pt-1 dark:border-neutral-800" : ""}
            >
              <ProviderGroup
                provider={p}
                isActive={p.id === active.id}
                onActivate={() => {
                  void activate(p.id);
                  setOpen(false);
                }}
                onPick={(model) => pick(p, model)}
              />
            </div>
          ))}
        </div>

        <div className="mt-2 flex items-center justify-between gap-2 border-t border-neutral-100 pt-2 dark:border-neutral-800">
          <span className="shrink-0 text-xs font-medium text-neutral-500 dark:text-neutral-400">
            {t("modelPicker.reasoningEffort")}
          </span>
          <Select
            size="sm"
            variant="quiet"
            className="min-w-0"
            ariaLabel={t("modelPicker.reasoningEffort")}
            title={t("modelPicker.effortHint")}
            value={active.reasoningEffort ?? "default"}
            onChange={(v) =>
              void update(active.id, { reasoningEffort: isEffort(v) ? v : undefined })
            }
            options={effortOptions}
          />
        </div>

        {supportsUsage(active.id) && (
          <div className="mt-2 border-t border-neutral-100 pt-2 dark:border-neutral-800">
            {/* Keyed: the section's snapshot is fetched per provider, and a key
                change is the only correct remount if active moves under us. */}
            <UsageSection key={active.id} provider={active} />
          </div>
        )}

        <div className="mt-2 border-t border-neutral-100 pt-1.5 dark:border-neutral-800">
          <button
            type="button"
            onClick={() => {
              setOpen(false);
              setAddOpen(true);
            }}
            className="flex w-full cursor-pointer items-center rounded-md px-1.5 py-1 text-left text-xs font-medium text-neutral-500 hover:bg-neutral-100 hover:text-neutral-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 dark:text-neutral-400 dark:hover:bg-neutral-800 dark:hover:text-neutral-100"
          >
            {t("modelPicker.addProvider")}
          </button>
        </div>
      </Popover>
      <AddProviderDialog open={addOpen} onOpenChange={setAddOpen} />
    </>
  );
}
