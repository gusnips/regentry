import { useState } from "react";
import type { FormEvent } from "react";
import { Tabs } from "@base-ui-components/react";
import { useProvidersStore, PRESETS } from "./store";
import { ProviderIcon } from "./ProviderIcon";
import { Select } from "@/components/Select";
import { TextField } from "@/components/TextField";
import { Button } from "@/components/Button";
import type { ProviderShape } from "../types";

const TAB_CLASSES =
  "rounded-md px-3 py-1.5 text-sm text-neutral-600 data-[selected]:bg-brand-50 data-[selected]:font-medium data-[selected]:text-brand-800";

/**
 * Add-provider form — credentials only. Model and reasoning effort are
 * per-task choices made in the side panel, where the stored key lets us
 * list the endpoint's live models; they don't belong at setup time.
 */
export function ProviderForm({ onSaved }: { onSaved?: () => void }) {
  const add = useProvidersStore((s) => s.add);
  const [presetId, setPresetId] = useState(PRESETS[0]!.id);
  const [custom, setCustom] = useState(false);
  const [name, setName] = useState("");
  const [shape, setShape] = useState<ProviderShape>("openai");
  const [baseUrl, setBaseUrl] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const preset = PRESETS.find((p) => p.id === presetId);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);

    const resolvedShape = custom ? shape : preset!.shape;
    const resolvedUrl = custom ? baseUrl.trim() : preset!.baseUrl;
    const resolvedName = custom ? name.trim() : preset!.name;

    if (custom && !resolvedUrl) {
      setError("Base URL is required for a custom endpoint.");
      return;
    }
    if (custom && !resolvedName) {
      setError("Name is required for a custom endpoint.");
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
      });
      setApiKey("");
      setName("");
      setBaseUrl("");
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

      <p className="text-xs text-neutral-400">
        Model and reasoning effort are picked per task in the side panel — newest model by default.
      </p>

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
