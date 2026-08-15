import { useTranslation } from "react-i18next";
import { AddProviderDialog } from "./AddProviderDialog";
import { PRESETS } from "../presets";
import { BrandMark } from "@/components/BrandMark";
import { Button } from "@/components/Button";

/** First-run home — shown in the side panel while no provider is configured. */
export function Onboarding() {
  const { t } = useTranslation();
  return (
    <div className="flex flex-1 flex-col items-center justify-center p-6 text-center">
      <BrandMark size={56} glow />
      <div className="mt-5 text-lg font-semibold tracking-tight text-neutral-900 dark:text-neutral-100">
        {t("onboarding.title")}
      </div>
      <p className="mt-2 max-w-[300px] text-sm leading-relaxed text-neutral-600 dark:text-neutral-300">
        {t("onboarding.tagline")}
      </p>
      <p className="mt-3 max-w-[300px] text-xs leading-relaxed text-neutral-500 dark:text-neutral-400">
        {t("onboarding.connectPrompt")}
      </p>
      <AddProviderDialog
        trigger={<Button className="mt-5">{t("onboarding.addProvider")}</Button>}
      />
      <p className="mt-2.5 max-w-[300px] text-[11px] leading-relaxed text-neutral-400 dark:text-neutral-500">
        {t("onboarding.presetsNote", { count: PRESETS.length })}
      </p>
    </div>
  );
}
