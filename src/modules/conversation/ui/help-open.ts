import { useSyncExternalStore } from "react";

/**
 * The help sheet's open state, shared module-level so its three doors — the
 * /help command (slash-commands.ts is not a component), the composer's "?"
 * gesture, and the settings-menu item — all drive the one HelpDialog the
 * entrypoint renders. Same minimal pattern as the tip line's store.
 */
let open = false;
const listeners = new Set<() => void>();

export function setHelpOpen(next: boolean): void {
  if (open === next) return;
  open = next;
  for (const l of listeners) l();
}

/** Every door but the dialog's own close goes through here. */
export function openHelp(): void {
  setHelpOpen(true);
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useHelpOpen(): boolean {
  return useSyncExternalStore(subscribe, () => open);
}
