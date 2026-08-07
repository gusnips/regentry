import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { localeItem, LOCALE_LABELS, SUPPORTED_LOCALES } from "@/i18n";
import type { Locale } from "@/i18n";
import { SegmentedControl } from "./SegmentedControl";
import type { SegmentedOption } from "./SegmentedControl";

/** "" = auto (follow the browser) — SegmentedControl needs a string for every segment. */
type LocaleChoice = Locale | "";

/** Stored locale override, live-synced across contexts via storage watch. */
function useLocale(): [LocaleChoice, (choice: LocaleChoice) => void] {
  const [locale, setLocale] = useState<LocaleChoice>("");
  useEffect(() => {
    void localeItem.get().then((v) => setLocale(v ?? ""));
    return localeItem.watch((v) => setLocale(v ?? ""));
  }, []);
  return [locale, (choice) => void localeItem.set(choice === "" ? null : choice)];
}

/** Short codes keep four segments readable in a 400px side panel. */
const SHORT: Record<Locale, string> = { en: "EN", "pt-BR": "PT", es: "ES" };

export function LanguageToggle({ className }: { className?: string }) {
  const { t } = useTranslation();
  const [locale, setLocale] = useLocale();
  const options: SegmentedOption<LocaleChoice>[] = [
    { value: "", label: t("settings.languageAutoShort"), title: t("settings.languageAuto") },
    ...SUPPORTED_LOCALES.map((l) => ({ value: l, label: SHORT[l], title: LOCALE_LABELS[l] })),
  ];
  return (
    <SegmentedControl
      value={locale}
      onChange={setLocale}
      options={options}
      ariaLabel={t("settings.language")}
      className={className}
    />
  );
}
