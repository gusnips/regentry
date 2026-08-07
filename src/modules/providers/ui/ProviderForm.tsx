import { useState } from "react";
import type { FormEvent } from "react";
import { useProvidersStore, PRESETS } from "./store";
import type { ProviderShape } from "../types";

export function ProviderForm({ onSaved }: { onSaved?: () => void }) {
  const add = useProvidersStore((s) => s.add);
  const [presetId, setPresetId] = useState(PRESETS[0]!.id);
  const [custom, setCustom] = useState(false);
  const [name, setName] = useState("");
  const [shape, setShape] = useState<ProviderShape>("openai");
  const [baseUrl, setBaseUrl] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [model, setModel] = useState("");
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
      });
      setApiKey("");
      setModel("");
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
      <div className="flex gap-2">
        <button
          type="button"
          className={`flex-1 rounded-lg border px-3 py-2 text-sm ${!custom ? "border-blue-600 bg-blue-50 text-blue-800" : "border-neutral-300 text-neutral-600"}`}
          onClick={() => setCustom(false)}
        >
          Preset
        </button>
        <button
          type="button"
          className={`flex-1 rounded-lg border px-3 py-2 text-sm ${custom ? "border-blue-600 bg-blue-50 text-blue-800" : "border-neutral-300 text-neutral-600"}`}
          onClick={() => setCustom(true)}
        >
          Custom endpoint
        </button>
      </div>

      {!custom ? (
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium text-neutral-700">Provider</span>
          <select
            className="rounded-lg border border-neutral-300 px-3 py-2"
            value={presetId}
            onChange={(e) => setPresetId(e.target.value)}
          >
            {PRESETS.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name} ({p.shape})
              </option>
            ))}
          </select>
        </label>
      ) : (
        <>
          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium text-neutral-700">Name</span>
            <input
              className="rounded-lg border border-neutral-300 px-3 py-2"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="My provider"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium text-neutral-700">API shape</span>
            <select
              className="rounded-lg border border-neutral-300 px-3 py-2"
              value={shape}
              onChange={(e) => setShape(e.target.value as ProviderShape)}
            >
              <option value="openai">OpenAI-compatible (/chat/completions)</option>
              <option value="anthropic">Anthropic (/v1/messages)</option>
            </select>
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium text-neutral-700">Base URL</span>
            <input
              className="rounded-lg border border-neutral-300 px-3 py-2"
              value={baseUrl}
              onChange={(e) => setBaseUrl(e.target.value)}
              placeholder="https://api.example.com/v1"
            />
          </label>
        </>
      )}

      <label className="flex flex-col gap-1 text-sm">
        <span className="font-medium text-neutral-700">API key</span>
        <input
          className="rounded-lg border border-neutral-300 px-3 py-2"
          type="password"
          value={apiKey}
          onChange={(e) => setApiKey(e.target.value)}
          placeholder="sk-…"
          autoComplete="off"
        />
      </label>

      <label className="flex flex-col gap-1 text-sm">
        <span className="font-medium text-neutral-700">Model</span>
        {preset && preset.models.length > 0 ? (
          <select
            className="rounded-lg border border-neutral-300 px-3 py-2"
            value={model}
            onChange={(e) => setModel(e.target.value)}
          >
            <option value="">Select a model…</option>
            {preset.models.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
        ) : (
          <input
            className="rounded-lg border border-neutral-300 px-3 py-2"
            value={model}
            onChange={(e) => setModel(e.target.value)}
            placeholder="e.g. gpt-4o, claude-sonnet-5, llama3.1"
          />
        )}
      </label>

      {preset?.apiKeyUrl && !custom && (
        <a
          className="text-xs text-blue-600 hover:underline"
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

      <button
        type="submit"
        disabled={saving}
        className="rounded-lg bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-40"
      >
        {saving ? "Saving…" : "Add provider"}
      </button>
    </form>
  );
}
