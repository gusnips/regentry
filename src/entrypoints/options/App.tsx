import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { AddProviderDialog, ProviderList } from "@/modules/providers/ui";
import { Button } from "@/components/Button";
import { Select } from "@/components/Select";
import { useThemeMode } from "@/components/ThemeButton";
import type { ThemeMode } from "@/lib/theme";
import { localeItem, SUPPORTED_LOCALES, LOCALE_LABELS } from "@/i18n";
import type { Locale } from "@/i18n";

export default function App() {
  const { t } = useTranslation();
  const [mode, setMode] = useThemeMode();
  const [locale, setLocale] = useState<string>("");

  useEffect(() => {
    void localeItem.get().then((v) => setLocale(v ?? ""));
    return localeItem.watch((v) => setLocale(v ?? ""));
  }, []);

  const themeOptions: { value: ThemeMode; label: string }[] = [
    { value: "system", label: t("settings.themeSystem") },
    { value: "light", label: t("settings.themeLight") },
    { value: "dark", label: t("settings.themeDark") },
  ];

  const localeOptions = [
    { value: "", label: t("settings.languageAuto") },
    ...SUPPORTED_LOCALES.map((l) => ({ value: l, label: LOCALE_LABELS[l] })),
  ];

  return (
    <div className="mx-auto max-w-xl p-6">
      <h1 className="flex items-center gap-2 text-lg font-semibold text-neutral-900 dark:text-neutral-100">
        <img src="/icon.svg" className="h-6 w-6" alt="" />
        {t("settings.pageTitle")}
      </h1>

      <section className="mt-6">
        <h2 className="text-base font-semibold text-neutral-900 dark:text-neutral-100">
          {t("settings.appearance")}
        </h2>
        <div className="mt-3">
          <Select value={mode} onChange={(v) => setMode(v as ThemeMode)} options={themeOptions} />
        </div>
      </section>

      <section className="mt-6">
        <h2 className="text-base font-semibold text-neutral-900 dark:text-neutral-100">
          {t("settings.language")}
        </h2>
        <div className="mt-3">
          <Select
            value={locale}
            onChange={(v) => void localeItem.set(v === "" ? null : (v as Locale))}
            options={localeOptions}
          />
        </div>
      </section>

      <section className="mt-6">
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
