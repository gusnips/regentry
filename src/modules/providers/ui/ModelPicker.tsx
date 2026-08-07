import { useEffect } from "react";
import { useProvidersStore } from "./store";
import { ProviderIcon } from "./ProviderIcon";
import { PRESETS } from "../presets";
import { Select } from "@/components/Select";

/** Dropdown of configured providers — used in the side panel header. */
export function ModelPicker() {
  const { providers, activeId, loaded, load, activate } = useProvidersStore();

  useEffect(() => {
    if (!loaded) void load();
  }, [loaded, load]);

  if (providers.length === 0) {
    return (
      <button
        className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-1.5 text-xs text-amber-800"
        onClick={() => chrome.runtime.openOptionsPage()}
        title="No providers configured"
      >
        Set up a provider →
      </button>
    );
  }

  return (
    <Select
      className="max-w-[200px] py-1.5 text-xs"
      value={activeId ?? providers[0]!.id}
      onChange={(id) => void activate(id)}
      options={providers.map((p) => {
        const preset = PRESETS.find((pr) => pr.id === p.id);
        return {
          value: p.id,
          label: `${p.name} · ${p.model}`,
          icon: preset ? <ProviderIcon icon={preset.icon} size={18} /> : undefined,
        };
      })}
    />
  );
}
