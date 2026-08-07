import { useEffect, useState } from "react";
import { Popover } from "@base-ui-components/react";
import { useProvidersStore } from "./store";
import { ProviderIcon } from "./ProviderIcon";
import { listModels, pickLatestModel } from "../models";
import { PRESETS } from "../presets";
import type { ModelInfo, ProviderShape, ReasoningEffort } from "../types";
import { Select } from "@/components/Select";
import { TextField } from "@/components/TextField";

const EFFORT_OPTIONS = [
  { value: "default", label: "Provider default" },
  { value: "none", label: "None — fastest" },
  { value: "low", label: "Low" },
  { value: "medium", label: "Medium" },
  { value: "high", label: "High" },
  { value: "max", label: "Max — deepest" },
];

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

/**
 * Per-task model control — provider, model, and effort, changeable between
 * tasks from the panel header. Choices persist onto the provider's stored
 * config; the background snapshots it at run start, so edits apply to the
 * next task, never a run in flight.
 */
export function ModelPicker() {
  const { providers, activeId, loaded, load, activate, update } = useProvidersStore();

  useEffect(() => {
    if (!loaded) void load();
  }, [loaded, load]);

  const active = providers.find((p) => p.id === activeId) ?? providers[0];
  // Only the connection fields key the fetch — changing model/effort must not refetch.
  const { models, loading, error } = useModels(
    active ? { shape: active.shape, baseUrl: active.baseUrl, apiKey: active.apiKey } : null,
  );

  // With zero providers the side panel shows Onboarding instead of this picker.
  if (!active) return null;

  const preset = PRESETS.find((pr) => pr.id === active.id);
  const listedIds = models.length > 0 ? models.map((m) => m.id) : (preset?.models ?? []);
  const autoTarget = pickLatestModel(models)?.id ?? preset?.models[0];

  const modelOptions = [
    {
      value: "",
      label: loading
        ? "Auto — loading models…"
        : `Auto — latest${autoTarget ? ` (${autoTarget})` : ""}`,
    },
    ...listedIds.map((id) => ({ value: id, label: id })),
  ];
  // A persisted id the endpoint no longer lists (e.g. k3[1m]) stays selectable.
  if (active.model && !listedIds.includes(active.model)) {
    modelOptions.push({ value: active.model, label: `${active.model} (current)` });
  }
  // No list route and no preset data (custom endpoints) → free text.
  const freeText = !loading && listedIds.length === 0;

  return (
    <Popover.Root>
      <Popover.Trigger
        className="flex max-w-[160px] items-center gap-1.5 rounded-lg border border-neutral-300 bg-white px-2.5 py-1.5 text-xs text-neutral-900 hover:border-neutral-400 data-[popup-open]:border-brand-500"
        title="Provider, model, and reasoning effort for the next task"
      >
        {preset && <ProviderIcon icon={preset.icon} size={16} />}
        <span className="truncate">
          {active.name} · {active.model ?? "Auto"}
        </span>
        <span className="text-neutral-400">▾</span>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Positioner sideOffset={6} align="end" className="z-50">
          <Popover.Popup className="w-72 rounded-lg border border-neutral-200 bg-white p-3 shadow-lg">
            <div className="flex flex-col gap-3">
              <div className="flex flex-col gap-1 text-sm">
                <span className="font-medium text-neutral-700">Provider</span>
                <Select
                  value={active.id}
                  onChange={(id) => void activate(id)}
                  options={providers.map((p) => {
                    const pr = PRESETS.find((x) => x.id === p.id);
                    return {
                      value: p.id,
                      label: p.name,
                      icon: pr ? <ProviderIcon icon={pr.icon} size={18} /> : undefined,
                    };
                  })}
                />
              </div>

              <div className="flex flex-col gap-1 text-sm">
                <span className="font-medium text-neutral-700">Model</span>
                {freeText ? (
                  <>
                    <TextField
                      value={active.model ?? ""}
                      onChange={(e) =>
                        void update(active.id, { model: e.target.value || undefined })
                      }
                      placeholder="model id — empty = auto"
                    />
                    {error && (
                      <span className="text-xs text-neutral-400">
                        The endpoint didn't return a model list — type an id, or leave empty to
                        auto-pick at run time.
                      </span>
                    )}
                  </>
                ) : (
                  <Select
                    value={active.model ?? ""}
                    onChange={(v) => void update(active.id, { model: v || undefined })}
                    options={modelOptions}
                  />
                )}
              </div>

              <div className="flex flex-col gap-1 text-sm">
                <span className="font-medium text-neutral-700">Reasoning effort</span>
                <Select
                  value={active.reasoningEffort ?? "default"}
                  onChange={(v) =>
                    void update(active.id, {
                      reasoningEffort: v === "default" ? undefined : (v as ReasoningEffort),
                    })
                  }
                  options={EFFORT_OPTIONS}
                />
                <span className="text-xs text-neutral-400">
                  An unsupported level fails with a clear provider error in chat.
                </span>
              </div>

              <p className="border-t border-neutral-100 pt-2 text-[11px] text-neutral-400">
                Changes apply from your next task — a run in flight keeps its snapshot.
              </p>
            </div>
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}
