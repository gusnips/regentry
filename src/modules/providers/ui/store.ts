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
  /** Forget an OAuth sign-in but keep the provider — signing in again restores it. */
  signOut: (id: string) => Promise<void>;
}

let watchersStarted = false;
/** Shared in-flight promise — App and the header chips mount together and must fetch once. */
let loadPromise: Promise<void> | null = null;

export const useProvidersStore = create<ProvidersState>((set, get) => ({
  providers: [],
  activeId: null,
  loaded: false,

  load: () => {
    if (get().loaded) return Promise.resolve();
    return (loadPromise ??= (async () => {
      try {
        const [providers, activeId] = await Promise.all([getProviders(), getActiveProviderId()]);
        set({ providers, activeId, loaded: true });

        if (!watchersStarted) {
          watchersStarted = true;
          watchProviders((providers) => set({ providers }));
          watchActiveProvider((activeId) => set({ activeId }));
        }
      } finally {
        // A failed load stays retryable; a successful one is guarded by `loaded`.
        loadPromise = null;
      }
    })());
  },

  add: async (input) => {
    const provider: ProviderConfig = {
      ...input,
      id: input.id ?? `custom-${Date.now()}`,
      createdAt: Date.now(),
    };
    await saveProvider(provider);
    // The provider you just set up is the one you want to run on — adding
    // (or signing in to / keying) one switches to it. Removing still falls
    // back to the next provider in storage.
    await setActiveProvider(provider.id);
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

  signOut: async (id) => {
    const current = get().providers.find((p) => p.id === id);
    if (!current?.auth) return;
    const next = { ...current };
    delete next.auth;
    await saveProvider(next);
  },
}));
