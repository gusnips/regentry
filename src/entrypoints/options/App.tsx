import { useTranslation } from "react-i18next";
import { AddProviderDialog, ProviderList } from "@/modules/providers/ui";
import { InstructionsSection, MemorySection } from "@/modules/memory/ui";
import { Button } from "@/components/Button";
import { ThemeToggle } from "@/components/ThemeControl";
import { LanguageToggle } from "@/components/LanguageToggle";

export default function App() {
  const { t } = useTranslation();

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

      <MemorySection />
    </div>
  );
}
