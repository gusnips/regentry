import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { useProvidersStore, activeProviderOf } from "./store";
import { engineLabel } from "./engine-label";
import { FILTER_THRESHOLD, narrowModels } from "./narrow-models";
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
import { CheckIcon, ChevronDownIcon, ChevronRightIcon } from "@/components/Icon";

/**
 * The engine picker — provider, model, and reasoning effort behind one quiet
 * chip in the composer footer (the layout every agent harness converged on:
 * the control sits where the task is typed, and effort folds into the model
 * picker rather than living as a peer select). Choices persist onto the
 * provider's stored config; the background snapshots it at run start, so
 * edits apply to the next task, never a run in flight.
 *
 * **It has to hold ten connected providers, not two.** So the list is an
 * accordion, and that shape is load-bearing twice over:
 *
 * - Only an OPEN group lists models, because listing means an authenticated
 *   request to that endpoint. Rendering every provider's models at once fired
 *   one per connected provider on every open — ten calls, several of them to
 *   rate-sensitive subscription endpoints, for a list the user wasn't reading.
 *   A closed row costs nothing: it names its saved choice from the session
 *   cache (or the preset), which is already in memory.
 * - A closed row is one line, so the popover stays a glance at any count. An
 *   open group is bounded too — OpenRouter lists 300+ models and Ollama lists
 *   whatever is installed, so long lists grow a filter and cap their rows.
 *
 * Clicking a provider's row switches to it with its own saved model and effort
 * intact — the one-click common case, since those choices are per provider. The
 * chevron opens it to browse instead, and a model row switches AND pins in one
 * go. Below the list: one effort row for the active provider, then the
 * rare-but-real utilities — subscription usage and adding a provider — that
 * used to cost their own header chrome.
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
      cancelled = true;
    };
    // target identity is captured by key
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  // Cache hits resolve during render (a reopened or switched group never waits
  // on a fetch it already paid for); errors are never cached, so a failed
  // listing retries the next time the group is opened.
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

/** What a provider is set to run, named without touching the network. */
function savedChoiceLabel(p: ProviderConfig, autoText: string): string {
  const known = knownModels(p);
  if (p.model) return known.find((m) => m.id === p.model)?.name ?? p.model;
  const auto = pickLatestModel(known);
  return auto ? `${autoText} · ${auto.name ?? auto.id}` : autoText;
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
  children: ReactNode;
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
 * One open group's model rows. Its own component so the fetch hook mounts only
 * while the group is open — that is the whole reason ten connected providers
 * don't mean ten listing calls per popover.
 */
function ModelList({
  provider,
  isActive,
  onPick,
}: {
  provider: ProviderConfig;
  isActive: boolean;
  onPick: (model: string | undefined) => void;
}) {
  const { t } = useTranslation();
  const { models, loading, error } = useModels(modelsTarget(provider));
  const [filter, setFilter] = useState("");
  const preset = PRESETS.find((pr) => pr.id === provider.id);
  // Live list wins; presets are the fallback for endpoints without a list route.
  const listed: ModelInfo[] =
    models.length > 0 ? models : (preset?.models.map((id) => ({ id })) ?? []);
  const autoTarget = pickLatestModel(models) ?? listed[0];

  if (loading) {
    return (
      <div className="px-2 py-1 text-xs text-neutral-400 dark:text-neutral-500">
        {t("enginePicker.loadingModels")}
      </div>
    );
  }

  // No list route and no preset data (custom endpoints, a dead listing) → free text.
  if (listed.length === 0) {
    return (
      <TextField
        size="sm"
        aria-label={t("modelPicker.model")}
        title={error ? t("modelPicker.noModelListHint") : undefined}
        className="mx-1.5 mt-0.5"
        value={provider.model ?? ""}
        onChange={(e) => onPick(e.target.value || undefined)}
        placeholder={t("modelPicker.freeTextPlaceholder")}
      />
    );
  }

  const { shown, hidden, matched } = narrowModels(listed, filter);
  const filterable = listed.length > FILTER_THRESHOLD;

  return (
    <>
      {filterable && (
        <TextField
          size="sm"
          autoFocus
          aria-label={t("enginePicker.filterAria")}
          className="mx-1.5 mt-0.5 mb-1"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder={t("enginePicker.filterPlaceholder", { n: listed.length })}
        />
      )}

      {/* Auto leads and shows what it will actually run, tagged so it stays
          distinguishable from having pinned that same model by hand. It is the
          mode, not a match, so filtering never hides it. */}
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

      {shown.map((m) => (
        <Row
          key={m.id}
          selected={isActive && provider.model === m.id}
          onClick={() => onPick(m.id)}
          title={m.id}
        >
          <span className="min-w-0 truncate">{m.name ?? m.id}</span>
        </Row>
      ))}

      {/* Both dead ends get a way forward, never a blank gap. */}
      {matched === 0 && (
        <p className="px-2 py-1 text-xs text-neutral-500 dark:text-neutral-400">
          {t("enginePicker.noMatch", { query: filter.trim() })}
        </p>
      )}
      {hidden > 0 && (
        <p className="px-2 py-1 text-[11px] text-neutral-400 dark:text-neutral-500">
          {t("enginePicker.moreModels", { n: hidden })}
        </p>
      )}

      {/* A persisted id the endpoint no longer lists stays selectable. */}
      {isActive && provider.model && !listed.some((m) => m.id === provider.model) && (
        <Row selected onClick={() => onPick(provider.model)} title={t("modelPicker.notListed")}>
          <span className="min-w-0 truncate">{provider.model}</span>
          <span className="ml-auto shrink-0 text-[10px] text-neutral-400 dark:text-neutral-500">
            {t("modelPicker.notListed")}
          </span>
        </Row>
      )}
    </>
  );
}

/**
 * One provider: a row that switches to it (keeping its own saved model and
 * effort), plus a chevron that opens its models. The active provider's row
 * toggles instead of switching — switching to what is already running is a
 * no-op, so the click may as well do the useful thing.
 */
function ProviderSection({
  provider,
  isActive,
  open,
  onToggle,
  onSwitch,
  onPick,
}: {
  provider: ProviderConfig;
  isActive: boolean;
  open: boolean;
  onToggle: () => void;
  onSwitch: () => void;
  onPick: (model: string | undefined) => void;
}) {
  const { t } = useTranslation();
  const preset = PRESETS.find((pr) => pr.id === provider.id);
  const saved = savedChoiceLabel(provider, t("modelPicker.auto"));

  return (
    <div className="flex flex-col">
      <div className="flex items-center gap-0.5">
        <button
          type="button"
          onClick={isActive ? onToggle : onSwitch}
          title={isActive ? t("enginePicker.browseTitle") : t("enginePicker.useProviderTitle")}
          className={`flex min-w-0 flex-1 cursor-pointer items-center gap-1.5 rounded-md px-1.5 py-1 text-left text-xs hover:bg-neutral-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 dark:hover:bg-neutral-800 ${
            isActive
              ? "font-medium text-neutral-900 dark:text-neutral-100"
              : "text-neutral-600 dark:text-neutral-400"
          }`}
        >
          {preset && <ProviderIcon icon={preset.icon} size={13} />}
          <span className="shrink-0 truncate">{providerDisplayName(provider)}</span>
          {/* The saved choice, so a closed row still answers "set to what?" —
              dimmed, because the provider's name is what you scan for. */}
          <span className="min-w-0 truncate text-[11px] text-neutral-400 dark:text-neutral-500">
            {saved}
          </span>
          {isActive && (
            <span className="ml-auto shrink-0 rounded bg-brand-50 px-1 py-px text-[10px] font-medium text-brand-700 dark:bg-brand-950/60 dark:text-brand-300">
              {t("enginePicker.current")}
            </span>
          )}
        </button>
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={open}
          aria-label={t("enginePicker.browseTitle")}
          title={t("enginePicker.browseTitle")}
          className="flex shrink-0 cursor-pointer items-center rounded-md px-1 py-1 text-neutral-400 hover:bg-neutral-100 hover:text-neutral-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 dark:hover:bg-neutral-800 dark:hover:text-neutral-200"
        >
          {open ? <ChevronDownIcon size={12} /> : <ChevronRightIcon size={12} />}
        </button>
      </div>

      {open && <ModelList provider={provider} isActive={isActive} onPick={onPick} />}
    </div>
  );
}

export function EnginePicker() {
  const { t } = useTranslation();
  const { providers, activate, update } = useProvidersStore();
  const active = useActiveProvider();
  const [open, setOpen] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  // Which group is open. One at a time: two open lists are two fetches and a
  // popover you have to scroll. null = every group closed; undefined would mean
  // "not decided yet", which is what the active-provider default below covers.
  const [openGroup, setOpenGroup] = useState<string | null>(null);

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
  // both choices. The row's own switch path keeps that provider's saved model.
  const pick = (p: ProviderConfig, model: string | undefined) => {
    if (p.id !== active.id) void activate(p.id);
    void update(p.id, { model });
    setOpen(false);
  };

  const switchTo = (p: ProviderConfig) => {
    void activate(p.id);
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
        onOpenChange={(next) => {
          setOpen(next);
          // Every open starts on the active provider's models — the list you
          // came for — and forgets whatever you were browsing last time.
          if (next) setOpenGroup(active.id);
        }}
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
          {providers.map((p) => (
            <ProviderSection
              key={p.id}
              provider={p}
              isActive={p.id === active.id}
              open={openGroup === p.id}
              onToggle={() => setOpenGroup((cur) => (cur === p.id ? null : p.id))}
              onSwitch={() => switchTo(p)}
              onPick={(model) => pick(p, model)}
            />
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
