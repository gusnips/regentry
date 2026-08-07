import { create } from "zustand";
import {
  getProviders,
  saveProvider,
  removeProvider,
  getActiveProviderId,
  setActiveProvider,
  watchProviders,
  watchActiveProvider,
  PRESETS,
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
}

let watchersStarted = false;

export const useProvidersStore = create<ProvidersState>((set) => ({
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
}));

export { PRESETS };
