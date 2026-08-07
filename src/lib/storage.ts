import { storage } from "wxt/utils/storage";

/**
 * Thin wrapper around wxt storage that gives us typed, namespace-prefixed keys.
 * Each domain module defines its own items using this helper.
 */
export function defineItem<T>(key: string, fallback: T) {
  const item = storage.defineItem<T>(`local:regent:${key}`, { fallback });
  return {
    get: () => item.getValue(),
    set: (v: T) => item.setValue(v),
    remove: () => item.removeValue(),
    watch: (cb: (newVal: T) => void) => item.watch(cb),
  };
}
