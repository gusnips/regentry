import { defineItem } from "@/lib/storage";
import type { ProviderConfig } from "./types";

const providersItem = defineItem<ProviderConfig[]>("providers", []);
const activeIdItem = defineItem<string | null>("active-provider", null);

export async function getProviders(): Promise<ProviderConfig[]> {
  return providersItem.get();
}

export async function getProvider(id: string): Promise<ProviderConfig | undefined> {
  const list = await providersItem.get();
  return list.find((p) => p.id === id);
}

export async function saveProvider(provider: ProviderConfig): Promise<void> {
  const list = await providersItem.get();
  const idx = list.findIndex((p) => p.id === provider.id);
  if (idx >= 0) {
    list[idx] = provider;
  } else {
    list.push(provider);
  }
  await providersItem.set(list);
}

export async function removeProvider(id: string): Promise<void> {
  const list = await providersItem.get();
  await providersItem.set(list.filter((p) => p.id !== id));
}

export async function getActiveProviderId(): Promise<string | null> {
  return activeIdItem.get();
}

export async function getActiveProvider(): Promise<ProviderConfig | undefined> {
  const id = await activeIdItem.get();
  if (!id) return undefined;
  return getProvider(id);
}

export async function setActiveProvider(id: string): Promise<void> {
  await activeIdItem.set(id);
}

export function watchProviders(cb: (providers: ProviderConfig[]) => void) {
  return providersItem.watch(cb);
}

export function watchActiveProvider(cb: (id: string | null) => void) {
  return activeIdItem.watch(cb);
}
