import { create } from "zustand";
import {
  getProviders,
  saveProvider,
  removeProvider,
  getActiveProviderId,
  setActiveProvider,
  watchProviders,
  watchActiveProvider,
} from "../index";
import type { ProviderConfig } from "../types";

interface ProvidersState {
  providers: ProviderConfig[];
  activeId: string | null;
  loaded: boolean;

  load: () => Promise<void>;
  add: (input: Omit<ProviderConfig, "id" | "createdAt"> & { id?: string }) => Promise<void>;
  remove: (id: string) => Promise<void>;
  activate: (id: string) => Promise<void>;
  /** Patch a stored provider's per-task choices (model / effort). Falsy = back to auto/default. */
  update: (
    id: string,
    patch: Partial<Pick<ProviderConfig, "model" | "reasoningEffort">>,
  ) => Promise<void>;
}

let watchersStarted = false;

export const useProvidersStore = create<ProvidersState>((set, get) => ({
  providers: [],
  activeId: null,
  loaded: false,

  load: async () => {
    const [providers, activeId] = await Promise.all([getProviders(), getActiveProviderId()]);
    set({ providers, activeId, loaded: true });

    if (!watchersStarted) {
      watchersStarted = true;
      watchProviders((providers) => set({ providers }));
      watchActiveProvider((activeId) => set({ activeId }));
    }
  },

  add: async (input) => {
    const provider: ProviderConfig = {
      ...input,
      id: input.id ?? `custom-${Date.now()}`,
      createdAt: Date.now(),
    };
    await saveProvider(provider);
    // Auto-activate the first provider
    const activeId = await getActiveProviderId();
    if (!activeId) await setActiveProvider(provider.id);
  },

  remove: async (id) => {
    await removeProvider(id);
  },

  activate: async (id) => {
    await setActiveProvider(id);
  },

  update: async (id, patch) => {
    const current = get().providers.find((p) => p.id === id);
    if (!current) return;
    const next = { ...current, ...patch };
    // Falsy means "back to auto/default" — drop the key rather than storing "".
    if (!next.model) delete next.model;
    if (!next.reasoningEffort) delete next.reasoningEffort;
    await saveProvider(next);
  },
}));
