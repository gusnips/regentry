import { Popover as BasePopover } from "@base-ui-components/react";
import type { ReactElement, ReactNode } from "react";

/**
 * Anchored, non-blocking overlay for glanceable content — where a dialog would
 * hijack the screen for a look-and-leave. The trigger element must forward
 * props (our Button does).
 */
export function Popover({ trigger, children }: { trigger: ReactElement; children: ReactNode }) {
  return (
    <BasePopover.Root>
      <BasePopover.Trigger render={trigger as ReactElement<Record<string, unknown>>} />
      <BasePopover.Portal>
        <BasePopover.Positioner sideOffset={6} className="z-50">
          <BasePopover.Popup className="w-64 rounded-xl border border-neutral-200 bg-white p-3 shadow-xl dark:border-neutral-700 dark:bg-neutral-900">
            {children}
          </BasePopover.Popup>
        </BasePopover.Positioner>
      </BasePopover.Portal>
    </BasePopover.Root>
  );
}
