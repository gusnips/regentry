import { useState } from "react";
import type { FormEvent } from "react";
import { Tabs } from "@base-ui-components/react";
import { useProvidersStore, PRESETS } from "./store";
import { ProviderIcon } from "./ProviderIcon";
import { Select } from "@/components/Select";
import { TextField } from "@/components/TextField";
import { Button } from "@/components/Button";
import type { ProviderShape, ReasoningEffort } from "../types";

const EFFORT_OPTIONS = [
  { value: "default", label: "Provider default" },
  { value: "none", label: "None — fastest" },
  { value: "low", label: "Low" },
  { value: "medium", label: "Medium" },
  { value: "high", label: "High" },
  { value: "max", label: "Max — deepest" },
];

const TAB_CLASSES =
  "rounded-md px-3 py-1.5 text-sm text-neutral-600 data-[selected]:bg-brand-50 data-[selected]:font-medium data-[selected]:text-brand-800";

export function ProviderForm({ onSaved }: { onSaved?: () => void }) {
  const add = useProvidersStore((s) => s.add);
  const [presetId, setPresetId] = useState(PRESETS[0]!.id);
  const [custom, setCustom] = useState(false);
  const [name, setName] = useState("");
  const [shape, setShape] = useState<ProviderShape>("openai");
  const [baseUrl, setBaseUrl] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [model, setModel] = useState("");
  const [effort, setEffort] = useState<ReasoningEffort | "default">("default");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const preset = PRESETS.find((p) => p.id === presetId);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);

    const resolvedShape = custom ? shape : preset!.shape;
    const resolvedUrl = custom ? baseUrl.trim() : preset!.baseUrl;
    const resolvedName = custom ? name.trim() : preset!.name;
    const resolvedModel = model.trim();

    if (!resolvedModel) {
      setError("Model is required.");
      return;
    }
    if (custom && !resolvedUrl) {
      setError("Base URL is required for a custom endpoint.");
      return;
    }
    if (!apiKey.trim() && !resolvedUrl.includes("localhost")) {
      setError("API key is required (not needed for local endpoints).");
      return;
    }

    setSaving(true);
    try {
      await add({
        id: custom ? undefined : presetId,
        name: resolvedName,
        shape: resolvedShape,
        baseUrl: resolvedUrl,
        apiKey: apiKey.trim(),
        model: resolvedModel,
        reasoningEffort: effort === "default" ? undefined : effort,
      });
      setApiKey("");
      setModel("");
      setName("");
      setBaseUrl("");
      setEffort("default");
      onSaved?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-3">
      <Tabs.Root
        value={custom ? "custom" : "preset"}
        onValueChange={(v) => setCustom(v === "custom")}
      >
        <Tabs.List className="grid grid-cols-2 gap-1 rounded-lg border border-neutral-200 p-1">
          <Tabs.Tab value="preset" className={TAB_CLASSES}>
            Preset
          </Tabs.Tab>
          <Tabs.Tab value="custom" className={TAB_CLASSES}>
            Custom endpoint
          </Tabs.Tab>
        </Tabs.List>
      </Tabs.Root>

      {!custom ? (
        <div className="flex flex-col gap-1 text-sm">
          <span className="font-medium text-neutral-700">Provider</span>
          <Select
            value={presetId}
            onChange={setPresetId}
            options={PRESETS.map((p) => ({
              value: p.id,
              label: `${p.name} (${p.shape})`,
              icon: <ProviderIcon icon={p.icon} size={20} />,
            }))}
          />
          {preset && <span className="text-xs text-neutral-400">{preset.baseUrl}</span>}
        </div>
      ) : (
        <>
          <TextField
            label="Name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="My provider"
          />
          <div className="flex flex-col gap-1 text-sm">
            <span className="font-medium text-neutral-700">API shape</span>
            <Select
              value={shape}
              onChange={(v) => setShape(v as ProviderShape)}
              options={[
                { value: "openai", label: "OpenAI-compatible (/chat/completions)" },
                { value: "anthropic", label: "Anthropic (/v1/messages)" },
              ]}
            />
          </div>
          <TextField
            label="Base URL"
            value={baseUrl}
            onChange={(e) => setBaseUrl(e.target.value)}
            placeholder="https://api.example.com/v1"
          />
        </>
      )}

      <TextField
        label="API key"
        type="password"
        value={apiKey}
        onChange={(e) => setApiKey(e.target.value)}
        placeholder="sk-…"
        autoComplete="off"
      />

      <div className="flex flex-col gap-1 text-sm">
        <span className="font-medium text-neutral-700">Model</span>
        {preset && preset.models.length > 0 ? (
          <Select
            value={model}
            onChange={setModel}
            placeholder="Select a model…"
            options={preset.models.map((m) => ({ value: m, label: m }))}
          />
        ) : (
          <TextField
            value={model}
            onChange={(e) => setModel(e.target.value)}
            placeholder="e.g. gpt-4o, claude-sonnet-5, llama3.1"
          />
        )}
      </div>

      <div className="flex flex-col gap-1 text-sm">
        <span className="font-medium text-neutral-700">Reasoning effort</span>
        <Select
          value={effort}
          onChange={(v) => setEffort(v as ReasoningEffort | "default")}
          options={EFFORT_OPTIONS}
        />
        <span className="text-xs text-neutral-400">
          How hard the model thinks before acting. Not every model accepts every level — an
          unsupported one fails with a clear provider error.
        </span>
      </div>

      {preset?.apiKeyUrl && !custom && (
        <a
          className="text-xs text-brand-600 hover:underline"
          href={preset.apiKeyUrl}
          target="_blank"
          rel="noreferrer"
        >
          Get an API key →
        </a>
      )}

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
          {error}
        </div>
      )}

      <Button type="submit" disabled={saving}>
        {saving ? "Saving…" : "Add provider"}
      </Button>
    </form>
  );
}
