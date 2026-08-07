import { useState } from "react";
import type { ReactElement } from "react";
import { useTranslation } from "react-i18next";
import { Dialog } from "@base-ui-components/react";
import { ProviderForm } from "./ProviderForm";
import type { ProviderConfig } from "../types";

/**
 * The add-provider form in a dialog — shared by the options page, the side-panel
 * onboarding, chat error recovery, and the header provider select. Auto-height;
 * scrolls only past 90vh. Pass `initialProvider` to open it as an edit
 * ("Update …"); pass `open`/`onOpenChange` to drive it without a trigger element.
 */
export function AddProviderDialog({
  trigger,
  initialProvider,
  open: openProp,
  onOpenChange,
}: {
  trigger?: ReactElement;
  initialProvider?: ProviderConfig;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}) {
  const [openState, setOpenState] = useState(false);
  const open = openProp ?? openState;
  const setOpen = onOpenChange ?? setOpenState;
  const { t } = useTranslation();
  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      {trigger && <Dialog.Trigger render={trigger as ReactElement<Record<string, unknown>>} />}
      <Dialog.Portal>
        <Dialog.Backdrop className="fixed inset-0 z-50 bg-black/30 dark:bg-black/60" />
        <Dialog.Popup className="fixed top-1/2 left-1/2 z-50 max-h-[90vh] w-[min(26rem,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-xl border border-neutral-200 bg-white p-4 shadow-xl dark:border-neutral-700 dark:bg-neutral-900">
          <div className="flex items-start justify-between gap-2">
            <div>
              <Dialog.Title className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">
                {initialProvider
                  ? t("providerForm.update", { name: initialProvider.name })
                  : t("addProvider.title")}
              </Dialog.Title>
              <Dialog.Description className="mt-0.5 text-xs text-neutral-500 dark:text-neutral-400">
                {t("addProvider.description")}
              </Dialog.Description>
            </div>
            <Dialog.Close
              aria-label={t("common.close")}
              className="rounded-md p-1 text-neutral-400 hover:bg-neutral-100 hover:text-neutral-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 dark:text-neutral-500 dark:hover:bg-neutral-800 dark:hover:text-neutral-300"
            >
              ✕
            </Dialog.Close>
          </div>
          <div className="mt-3">
            <ProviderForm onSaved={() => setOpen(false)} initialProvider={initialProvider} />
          </div>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
