import { useSyncExternalStore } from "react";

/**
 * The draft dialog's open state, shared module-level so `/skill new`
 * (slash-commands.ts is not a component) can open the one SkillDraftDialog the
 * side panel renders — the help sheet's exact pattern.
 */
let open = false;
const listeners = new Set<() => void>();

export function setSkillDraftOpen(next: boolean): void {
  if (open === next) return;
  open = next;
  for (const l of listeners) l();
}

export function openSkillDraft(): void {
  setSkillDraftOpen(true);
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useSkillDraftOpen(): boolean {
  return useSyncExternalStore(subscribe, () => open);
}
