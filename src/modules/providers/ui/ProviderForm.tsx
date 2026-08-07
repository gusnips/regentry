import { useState } from "react";
import type { FormEvent } from "react";
import { useProvidersStore } from "./store";
import { ProviderIcon } from "./ProviderIcon";
import { PRESETS } from "../presets";
import type { ProviderShape } from "../types";
import { Select } from "@/components/Select";
import { TextField } from "@/components/TextField";
import { PasswordField } from "@/components/PasswordField";
import { Button } from "@/components/Button";

const CUSTOM = "custom";

function isLocalUrl(url: string): boolean {
  try {
    const { hostname } = new URL(url);
    return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]";
  } catch {
    return false;
  }
}

/**
 * Add-provider form — credentials only. Model and reasoning effort are
 * per-task choices made in the side panel, where the stored key lets us
 * list the endpoint's live models; they don't belong at setup time.
 *
 * Picking an already-configured preset is the edit path: the CTA becomes
 * "Update …", model/effort choices are preserved, and an empty key keeps
 * the saved one (key rotation = paste a new one).
 */
export function ProviderForm({ onSaved }: { onSaved?: () => void }) {
  const add = useProvidersStore((s) => s.add);
  const providers = useProvidersStore((s) => s.providers);
  const [presetId, setPresetId] = useState(PRESETS[0]!.id);
  const [name, setName] = useState("");
  const [shape, setShape] = useState<ProviderShape>("openai");
  const [baseUrl, setBaseUrl] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const preset = presetId === CUSTOM ? undefined : PRESETS.find((p) => p.id === presetId);
  const existing = preset ? providers.find((p) => p.id === preset.id) : undefined;

  const fail = (message: string) => setError(message);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);

    const resolvedName = preset ? preset.name : name.trim();
    const resolvedUrl = preset ? preset.baseUrl : baseUrl.trim();
    const key = apiKey.trim();

    if (!preset && !resolvedName) {
      fail("Name is required — e.g. the service or gateway name.");
      return;
    }
    if (!preset && !resolvedUrl) {
      fail("Base URL is required for a custom endpoint.");
      return;
    }
    if (!preset) {
      try {
        new URL(resolvedUrl);
      } catch {
        fail(
          "Base URL isn't a valid URL — include https:// and any path, e.g. https://api.example.com/v1.",
        );
        return;
      }
    }
    if (!key && !existing && !isLocalUrl(resolvedUrl)) {
      fail("API key is required — paste it above. (Local endpoints like Ollama don't need one.)");
      return;
    }

    setSaving(true);
    try {
      await add({
        id: preset?.id, // custom → undefined → the store assigns custom-<ts>
        name: resolvedName,
        shape: preset ? preset.shape : shape,
        baseUrl: resolvedUrl,
        apiKey: key || (existing?.apiKey ?? ""),
        // Not asked at setup — preserved across an update, picked per task in the panel.
        model: existing?.model,
        reasoningEffort: existing?.reasoningEffort,
      });
      setApiKey("");
      setName("");
      setBaseUrl("");
      onSaved?.();
    } catch (err) {
      fail(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  const keyHint = isLocalUrl(preset ? preset.baseUrl : baseUrl.trim()) ? (
    "Optional for local endpoints."
  ) : existing ? (
    "Leave empty to keep the saved key."
  ) : preset?.apiKeyUrl ? (
    <a
      className="text-brand-600 hover:underline"
      href={preset.apiKeyUrl}
      target="_blank"
      rel="noreferrer"
    >
      Get an API key →
    </a>
  ) : undefined;

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-3">
      <div className="flex flex-col gap-1 text-sm">
        <span className="font-medium text-neutral-700">Provider</span>
        <Select
          value={presetId}
          onChange={setPresetId}
          options={[
            ...PRESETS.map((p) => ({
              value: p.id,
              label: providers.some((cp) => cp.id === p.id) ? `${p.name} · configured` : p.name,
              icon: <ProviderIcon icon={p.icon} size={20} />,
            })),
            { value: CUSTOM, label: "Custom endpoint…" },
          ]}
        />
        {preset && <span className="text-xs text-neutral-400">{preset.baseUrl}</span>}
      </div>

      {!preset && (
        <>
          <TextField
            label="Name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="My gateway"
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

      <PasswordField
        label="API key"
        value={apiKey}
        onChange={(e) => setApiKey(e.target.value)}
        placeholder={existing ? "Saved — leave empty to keep" : "sk-…"}
        autoComplete="off"
        hint={keyHint}
      />

      <p className="text-xs text-neutral-400">
        Model and reasoning effort are picked per task in the side panel — newest model by default.
      </p>

      {error && (
        <div
          role="alert"
          className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800"
        >
          {error}
        </div>
      )}

      <Button type="submit" disabled={saving}>
        {saving ? "Saving…" : existing ? `Update ${existing.name}` : "Add provider"}
      </Button>
    </form>
  );
}
