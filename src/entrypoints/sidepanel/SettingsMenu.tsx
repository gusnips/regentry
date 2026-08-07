import { useState } from "react";
import type { ReactNode } from "react";
import { Popover } from "@base-ui-components/react";
import { useTranslation } from "react-i18next";
import { AddProviderDialog } from "@/modules/providers/ui";
import { Button } from "@/components/Button";
import { ThemeToggle } from "@/components/ThemeControl";
import { LanguageToggle } from "@/components/LanguageToggle";

function GearIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.6 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.6a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9c.2.66.79 1.13 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </svg>
  );
}

function Section({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="px-1 py-1.5">
      <div className="mb-1.5 text-[11px] font-medium tracking-wide text-neutral-400 uppercase dark:text-neutral-500">
        {label}
      </div>
      {children}
    </div>
  );
}

/**
 * Panel settings home — the preferences you change while working (theme,
 * language) inline, and one step out to the options page for the rest.
 */
export function SettingsMenu() {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [addProviderOpen, setAddProviderOpen] = useState(false);

  return (
    <>
      <Popover.Root open={open} onOpenChange={setOpen}>
        <Popover.Trigger
          render={
            <Button
              variant="ghost"
              size="sm"
              className={`shrink-0 px-1.5 ${open ? "bg-neutral-100 dark:bg-neutral-800" : ""}`}
              title={t("settings.menuTitle")}
              aria-label={t("settings.menuTitle")}
            >
              <GearIcon />
            </Button>
          }
        />
        <Popover.Portal>
          <Popover.Positioner sideOffset={6} align="end" className="z-50">
            <Popover.Popup className="w-64 rounded-xl border border-neutral-200 bg-white p-2 shadow-lg dark:border-neutral-700 dark:bg-neutral-900">
              <Section label={t("settings.appearance")}>
                <ThemeToggle className="w-full" />
              </Section>
              <Section label={t("settings.language")}>
                <LanguageToggle className="w-full" />
              </Section>
              <div className="mt-1 flex flex-col border-t border-neutral-100 pt-1 dark:border-neutral-800">
                <Button
                  variant="ghost"
                  size="sm"
                  className="justify-start text-left"
                  onClick={() => {
                    // The dialog lives outside the popover, so closing here is safe.
                    setOpen(false);
                    setAddProviderOpen(true);
                  }}
                >
                  {t("settings.addProvider")}
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className="justify-start text-left"
                  onClick={() => {
                    setOpen(false);
                    void chrome.runtime.openOptionsPage();
                  }}
                >
                  {t("settings.allSettings")}
                </Button>
              </div>
            </Popover.Popup>
          </Popover.Positioner>
        </Popover.Portal>
      </Popover.Root>
      <AddProviderDialog open={addProviderOpen} onOpenChange={setAddProviderOpen} />
    </>
  );
}
