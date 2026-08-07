import { useTranslation } from "react-i18next";
import { AddProviderDialog } from "./AddProviderDialog";
import { PRESETS } from "../presets";
import { Button } from "@/components/Button";

/** First-run home — shown in the side panel while no provider is configured. */
export function Onboarding() {
  const { t } = useTranslation();
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center">
      <img src="/icon.svg" className="h-12 w-12" alt="" />
      <div className="text-base font-semibold text-neutral-900 dark:text-neutral-100">
        {t("onboarding.title")}
      </div>
      <p className="max-w-[280px] text-sm text-neutral-600 dark:text-neutral-400">
        {t("onboarding.tagline")}
      </p>
      <p className="max-w-[280px] text-xs text-neutral-500 dark:text-neutral-400">
        {t("onboarding.connectPrompt")}
      </p>
      <AddProviderDialog
        trigger={<Button className="mt-1">{t("onboarding.addProvider")}</Button>}
      />
      <p className="text-xs text-neutral-400 dark:text-neutral-500">
        {t("onboarding.presetsNote", { count: PRESETS.length })}
      </p>
    </div>
  );
}
