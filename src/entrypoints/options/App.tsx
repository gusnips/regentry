import { useState } from "react";
import { useTranslation } from "react-i18next";
import { AddProviderDialog, ProviderList } from "@/modules/providers/ui";
import { InstructionsSection, MemorySection } from "@/modules/memory/ui";
import { Button } from "@/components/Button";
import { Switch } from "@/components/Switch";
import { TextField } from "@/components/TextField";
import { useStoredItem } from "@/components/useStoredItem";
import { ThemeToggle } from "@/components/ThemeControl";
import { LanguageToggle } from "@/components/LanguageToggle";
import { defaultStartUrl, tipsEnabled, widgetHidden } from "@/lib/prefs";

/** A start page a background run can actually open — full http(s) URL only. */
function validStartUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

export default function App() {
  const { t } = useTranslation();
  // Stored inverted ("hidden") so the default needs no write; shown as the
  // positive toggle.
  const hidden = useStoredItem(widgetHidden);
  const tips = useStoredItem(tipsEnabled);
  const stored = useStoredItem(defaultStartUrl);
  // Edited locally, persisted on blur — a half-typed URL must never reach a run.
  const [startUrl, setStartUrl] = useState<string | null>(null);
  const [urlError, setUrlError] = useState(false);
  const urlValue = startUrl ?? stored;

  const commitStartUrl = () => {
    const value = urlValue.trim();
    if (validStartUrl(value)) {
      setUrlError(false);
      void defaultStartUrl.set(value);
      setStartUrl(null);
    } else {
      // Keep the text with the error under it — the fix happens here, and
      // nothing invalid ever reaches the store.
      setUrlError(true);
    }
  };

  return (
    <div className="mx-auto max-w-xl p-6">
      <h1 className="flex items-center gap-2 text-lg font-semibold text-neutral-900 dark:text-neutral-100">
        <img src="/icon.svg" className="h-6 w-6" alt="" />
        {t("settings.pageTitle")}
      </h1>

      {/* Same controls as the panel's gear menu — one mental model for both. */}
      <section className="mt-6 flex flex-wrap items-start gap-x-10 gap-y-4">
        <div>
          <h2 className="text-base font-semibold text-neutral-900 dark:text-neutral-100">
            {t("settings.appearance")}
          </h2>
          <div className="mt-3">
            <ThemeToggle />
          </div>
        </div>
        <div>
          <h2 className="text-base font-semibold text-neutral-900 dark:text-neutral-100">
            {t("settings.language")}
          </h2>
          <div className="mt-3">
            <LanguageToggle />
          </div>
        </div>
      </section>

      {/* Standing instructions shape every chat — not memory, so it sits on its own. */}
      <InstructionsSection />

      {/* Dispatch-and-forget knobs: where background tasks open, and whether
          the floating indicator reports them on the active tab. */}
      <section className="mt-8">
        <h2 className="text-base font-semibold text-neutral-900 dark:text-neutral-100">
          {t("settings.backgroundTasks")}
        </h2>
        <div className="mt-3 flex items-start justify-between gap-4">
          <div>
            <div className="text-sm font-medium text-neutral-800 dark:text-neutral-200">
              {t("settings.showWidget")}
            </div>
            <p className="mt-1 text-xs text-neutral-500 dark:text-neutral-400">
              {t("settings.showWidgetHint")}
            </p>
          </div>
          <Switch
            checked={!hidden}
            onChange={(v) => void widgetHidden.set(!v)}
            ariaLabel={t("settings.showWidget")}
          />
        </div>
        <div className="mt-4">
          <TextField
            label={t("settings.defaultStartUrl")}
            hint={
              urlError ? (
                <span className="text-red-600 dark:text-red-400">{t("settings.invalidUrl")}</span>
              ) : (
                t("settings.defaultStartUrlHint")
              )
            }
            value={urlValue}
            onChange={(e) => {
              setStartUrl(e.target.value);
              if (urlError) setUrlError(false);
            }}
            onBlur={commitStartUrl}
            placeholder={defaultStartUrl.fallback}
            inputMode="url"
            spellCheck={false}
            aria-invalid={urlError || undefined}
          />
        </div>
      </section>

      {/* Panel-only chrome — nothing here touches a background run. */}
      <section className="mt-8">
        <h2 className="text-base font-semibold text-neutral-900 dark:text-neutral-100">
          {t("settings.sidePanel")}
        </h2>
        <div className="mt-3 flex items-start justify-between gap-4">
          <div>
            <div className="text-sm font-medium text-neutral-800 dark:text-neutral-200">
              {t("settings.showTips")}
            </div>
            <p className="mt-1 text-xs text-neutral-500 dark:text-neutral-400">
              {t("settings.showTipsHint")}
            </p>
          </div>
          <Switch
            checked={tips}
            onChange={(v) => void tipsEnabled.set(v)}
            ariaLabel={t("settings.showTips")}
          />
        </div>
      </section>

      {/* What it has learned lives next to how it behaves — the two knowledge
          surfaces sit together, the provider machinery last. */}
      <MemorySection />

      <section className="mt-8">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-semibold text-neutral-900 dark:text-neutral-100">
            {t("settings.providers")}
          </h2>
          <AddProviderDialog trigger={<Button size="sm">{t("settings.addProvider")}</Button>} />
        </div>
        <div className="mt-3">
          <ProviderList />
        </div>
      </section>
    </div>
  );
}
