import { useState } from "react";
import type { FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { useProvidersStore } from "./store";
import { ProviderIcon } from "./ProviderIcon";
import { KimiSignIn } from "./KimiSignIn";
import { ClaudeSignIn } from "./ClaudeSignIn";
import { ChatGPTSignIn } from "./ChatGPTSignIn";
import { PRESETS } from "../presets";
import type { OAuthCredential, ProviderConfig, ProviderShape } from "../types";
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
 * the saved one (key rotation = paste a new one). Pass `initialProvider` to
 * open the form straight onto that provider's edit path — custom endpoints
 * included (they update in place instead of adding a duplicate).
 */
export function ProviderForm({
  onSaved,
  initialProvider,
}: {
  onSaved?: () => void;
  initialProvider?: ProviderConfig;
}) {
  const { t } = useTranslation();
  const add = useProvidersStore((s) => s.add);
  const providers = useProvidersStore((s) => s.providers);
  const initialPreset = initialProvider
    ? PRESETS.find((p) => p.id === initialProvider.id)
    : undefined;
  const [presetId, setPresetId] = useState(
    initialProvider ? (initialPreset?.id ?? CUSTOM) : PRESETS[0]!.id,
  );
  const [name, setName] = useState(initialProvider && !initialPreset ? initialProvider.name : "");
  const [shape, setShape] = useState<ProviderShape>(initialProvider?.shape ?? "openai");
  const [baseUrl, setBaseUrl] = useState(
    initialProvider && !initialPreset ? initialProvider.baseUrl : "",
  );
  const [apiKey, setApiKey] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const preset = presetId === CUSTOM ? undefined : PRESETS.find((p) => p.id === presetId);
  const existing = providers.find((p) => p.id === (preset ? preset.id : initialProvider?.id));
  // Signed in during this form's lifetime, before Save writes it through.
  const [pendingAuth, setPendingAuth] = useState<OAuthCredential | undefined>();
  const isOAuth = preset?.auth === "oauth";
  const auth = pendingAuth ?? existing?.auth;

  const fail = (message: string) => setError(message);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);

    const resolvedName = preset ? preset.name : name.trim();
    const resolvedUrl = preset ? preset.baseUrl : baseUrl.trim();
    const key = apiKey.trim();

    if (!preset && !resolvedName) {
      fail(t("providerForm.nameRequired"));
      return;
    }
    if (!preset && !resolvedUrl) {
      fail(t("providerForm.baseUrlRequired"));
      return;
    }
    if (!preset) {
      try {
        new URL(resolvedUrl);
      } catch {
        fail(t("providerForm.baseUrlInvalid"));
        return;
      }
    }
    // OAuth providers carry a credential instead of a key — sign-in is the gate.
    if (isOAuth) {
      if (!auth) {
        // Each vendor's sign-in is a different flow, so the message names its own.
        const requiredKey =
          preset.id === "claude"
            ? "providerForm.claudeSignInRequired"
            : preset.id === "chatgpt"
              ? "providerForm.chatgptSignInRequired"
              : "providerForm.kimiSignInRequired";
        fail(t(requiredKey));
        return;
      }
    } else if (!key && !existing && !isLocalUrl(resolvedUrl)) {
      fail(t("providerForm.apiKeyRequired"));
      return;
    }

    setSaving(true);
    try {
      await add({
        // Unseeded custom → undefined → the store assigns custom-<ts>.
        id: preset?.id ?? existing?.id,
        name: resolvedName,
        shape: preset ? preset.shape : shape,
        baseUrl: resolvedUrl,
        apiKey: key || (existing?.apiKey ?? ""),
        ...(auth ? { auth } : {}),
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
    t("providerForm.keyHintLocal")
  ) : existing ? (
    t("providerForm.keyHintKeep")
  ) : preset?.apiKeyUrl ? (
    <a
      className="text-brand-600 hover:underline dark:text-brand-400"
      href={preset.apiKeyUrl}
      target="_blank"
      rel="noreferrer"
    >
      {t("providerForm.keyHintGet")}
    </a>
  ) : undefined;

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-3">
      <div className="flex flex-col gap-1 text-sm">
        <span className="font-medium text-neutral-700 dark:text-neutral-300">
          {t("providerForm.provider")}
        </span>
        <Select
          value={presetId}
          onChange={setPresetId}
          options={[
            ...PRESETS.map((p) => ({
              value: p.id,
              label: providers.some((cp) => cp.id === p.id)
                ? t("providerForm.configured", { name: p.name })
                : p.name,
              icon: <ProviderIcon icon={p.icon} size={20} />,
            })),
            { value: CUSTOM, label: t("providerForm.customEndpoint") },
          ]}
        />
        {preset && (
          <span className="text-xs text-neutral-400 dark:text-neutral-500">{preset.baseUrl}</span>
        )}
      </div>

      {!preset && (
        <>
          <TextField
            label={t("providerForm.name")}
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={t("providerForm.namePlaceholder")}
          />
          <div className="flex flex-col gap-1 text-sm">
            <span className="font-medium text-neutral-700 dark:text-neutral-300">
              {t("providerForm.apiShape")}
            </span>
            <Select
              value={shape}
              onChange={(v) => setShape(v as ProviderShape)}
              options={[
                { value: "openai", label: t("providerForm.shapeOpenai") },
                { value: "anthropic", label: t("providerForm.shapeAnthropic") },
              ]}
            />
          </div>
          <TextField
            label={t("providerForm.baseUrl")}
            value={baseUrl}
            onChange={(e) => setBaseUrl(e.target.value)}
            placeholder="https://api.example.com/v1"
          />
        </>
      )}

      {isOAuth ? (
        preset.id === "claude" ? (
          <ClaudeSignIn signedIn={auth} onSignedIn={setPendingAuth} />
        ) : preset.id === "chatgpt" ? (
          <ChatGPTSignIn signedIn={auth} onSignedIn={setPendingAuth} />
        ) : (
          <KimiSignIn signedIn={auth} onSignedIn={setPendingAuth} />
        )
      ) : (
        <PasswordField
          label={t("providerForm.apiKey")}
          value={apiKey}
          onChange={(e) => setApiKey(e.target.value)}
          placeholder={
            existing
              ? t("providerForm.apiKeyPlaceholderSaved")
              : t("providerForm.apiKeyPlaceholder")
          }
          autoComplete="off"
          hint={keyHint}
        />
      )}

      <p className="text-xs text-neutral-400 dark:text-neutral-500">
        {t("providerForm.modelNote")}
      </p>

      {error && (
        <div
          role="alert"
          className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-200"
        >
          {error}
        </div>
      )}

      <Button type="submit" disabled={saving}>
        {saving
          ? t("providerForm.saving")
          : existing
            ? t("providerForm.update", { name: existing.name })
            : t("providerForm.add")}
      </Button>
    </form>
  );
}
