import { useTranslation } from "react-i18next";
import { localeItem, LOCALE_LABELS, SUPPORTED_LOCALES } from "@/i18n";
import type { Locale } from "@/i18n";
import { SegmentedControl } from "./SegmentedControl";
import type { SegmentedOption } from "./SegmentedControl";
import { useStoredItem } from "./useStoredItem";

/** "" = auto (follow the browser) — SegmentedControl needs a string for every segment. */
type LocaleChoice = Locale | "";

/** Short codes keep four segments readable in a 400px side panel. */
const SHORT: Record<Locale, string> = { en: "EN", "pt-BR": "PT", es: "ES" };

export function LanguageToggle({ className }: { className?: string }) {
  const { t } = useTranslation();
  // Stored as null = auto; the control shows that as the "" segment.
  const stored = useStoredItem(localeItem);
  const locale: LocaleChoice = stored ?? "";
  const options: SegmentedOption<LocaleChoice>[] = [
    { value: "", label: t("settings.languageAutoShort"), title: t("settings.languageAuto") },
    ...SUPPORTED_LOCALES.map((l) => ({ value: l, label: SHORT[l], title: LOCALE_LABELS[l] })),
  ];
  return (
    <SegmentedControl
      value={locale}
      onChange={(choice) => void localeItem.set(choice === "" ? null : choice)}
      options={options}
      ariaLabel={t("settings.language")}
      className={className}
    />
  );
}
