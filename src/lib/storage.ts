import { storage } from "wxt/utils/storage";

/** Typed, namespaced storage item — what `defineItem` returns. */
export interface StorageItem<T> {
  /** The default value, exposed so UI can seed state without a second literal. */
  fallback: T;
  get: () => Promise<T>;
  set: (v: T) => Promise<void>;
  remove: () => Promise<void>;
  watch: (cb: (newVal: T) => void) => () => void;
}

/**
 * Thin wrapper around wxt storage that gives us typed, namespace-prefixed keys.
 * Each domain module defines its own items using this helper.
 */
export function defineItem<T>(key: string, fallback: T): StorageItem<T> {
  const item = storage.defineItem<T>(`local:regent:${key}`, { fallback });
  return {
    fallback,
    get: () => item.getValue(),
    set: (v: T) => item.setValue(v),
    remove: () => item.removeValue(),
    watch: (cb: (newVal: T) => void) => item.watch(cb),
  };
}
