import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { useProvidersStore } from "./store";
import { ProviderIcon } from "./ProviderIcon";
import { AddProviderDialog } from "./AddProviderDialog";
import { PRESETS } from "../presets";
import { Button } from "@/components/Button";
import { ConfirmDialog } from "@/components/ConfirmDialog";

function hostOf(url: string): string | null {
  try {
    return new URL(url).hostname;
  } catch {
    return null;
  }
}

export function ProviderList() {
  const { t } = useTranslation();
  const { providers, activeId, loaded, load, remove, activate } = useProvidersStore();

  useEffect(() => {
    if (!loaded) void load();
  }, [loaded, load]);

  if (!loaded) return null;

  if (providers.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-neutral-300 p-6 text-center dark:border-neutral-700">
        <div className="text-sm font-medium text-neutral-700 dark:text-neutral-200">
          {t("providerList.emptyTitle")}
        </div>
        <p className="mt-1 text-xs text-neutral-500 dark:text-neutral-400">
          {t("providerList.emptyBody")}
        </p>
        <AddProviderDialog
          trigger={
            <Button size="sm" className="mt-3">
              {t("providerList.addFirst")}
            </Button>
          }
        />
      </div>
    );
  }

  return (
    <ul className="flex flex-col gap-2">
      {providers.map((p) => {
        const preset = PRESETS.find((pr) => pr.id === p.id);
        const isActive = p.id === activeId;
        const host = preset ? null : hostOf(p.baseUrl);
        return (
          <li
            key={p.id}
            className={`flex items-center justify-between rounded-lg border px-3 py-2 ${
              isActive
                ? "border-brand-500 bg-brand-50 dark:bg-brand-950"
                : "border-neutral-200 dark:border-neutral-700"
            }`}
          >
            <div className="flex min-w-0 items-center gap-2.5">
              {preset ? (
                <ProviderIcon icon={preset.icon} size={24} />
              ) : (
                <span
                  className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-neutral-500 text-[10px] font-bold text-white"
                  aria-hidden
                >
                  {p.shape === "anthropic" ? "A" : "O"}
                </span>
              )}
              <div className="min-w-0">
                <div className="flex items-center gap-1.5 text-sm font-medium text-neutral-900 dark:text-neutral-100">
                  <span className="truncate">{p.name}</span>
                  {isActive && (
                    <span className="shrink-0 rounded border border-brand-200 bg-white px-1.5 py-px text-[10px] font-medium text-brand-700 dark:border-brand-800 dark:bg-neutral-900 dark:text-brand-300">
                      {t("providerList.active")}
                    </span>
                  )}
                </div>
                <div className="truncate text-xs text-neutral-500 dark:text-neutral-400">
                  {p.model ?? t("providerList.auto")} · {p.shape}
                  {host ? ` · ${host}` : ""}
                  {p.reasoningEffort
                    ? ` · ${t("providerList.effort", { effort: p.reasoningEffort })}`
                    : ""}
                </div>
              </div>
            </div>
            <div className="ml-3 flex shrink-0 gap-2">
              {!isActive && (
                <Button variant="ghost" size="sm" onClick={() => void activate(p.id)}>
                  {t("providerList.setActive")}
                </Button>
              )}
              <ConfirmDialog
                trigger={
                  <Button variant="ghost-danger" size="sm">
                    {t("common.remove")}
                  </Button>
                }
                title={t("providerList.removeTitle", { name: p.name })}
                description={
                  isActive ? t("providerList.removeActiveBody") : t("providerList.removeBody")
                }
                onConfirm={() => void remove(p.id)}
              />
            </div>
          </li>
        );
      })}
    </ul>
  );
}
