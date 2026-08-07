import { useState } from "react";
import type { ReactElement } from "react";
import { Dialog } from "@base-ui-components/react";
import { ProviderForm } from "./ProviderForm";

/**
 * The add-provider form in a dialog titled "Add provider" — shared by the
 * options page and the side-panel onboarding. Auto-height; scrolls only past 90vh.
 */
export function AddProviderDialog({ trigger }: { trigger: ReactElement }) {
  const [open, setOpen] = useState(false);
  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Trigger render={trigger as ReactElement<Record<string, unknown>>} />
      <Dialog.Portal>
        <Dialog.Backdrop className="fixed inset-0 z-50 bg-black/30" />
        <Dialog.Popup className="fixed top-1/2 left-1/2 z-50 max-h-[90vh] w-[min(26rem,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-xl border border-neutral-200 bg-white p-4 shadow-xl">
          <div className="flex items-start justify-between gap-2">
            <div>
              <Dialog.Title className="text-sm font-semibold text-neutral-900">
                Add provider
              </Dialog.Title>
              <Dialog.Description className="mt-0.5 text-xs text-neutral-500">
                Keys are stored on this device and sent only to the provider.
              </Dialog.Description>
            </div>
            <Dialog.Close
              aria-label="Close"
              className="rounded-md p-1 text-neutral-400 hover:bg-neutral-100 hover:text-neutral-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
            >
              ✕
            </Dialog.Close>
          </div>
          <div className="mt-3">
            <ProviderForm onSaved={() => setOpen(false)} />
          </div>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
