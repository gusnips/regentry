import { useEffect } from "react";
import { useProvidersStore } from "./store";

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
    <select
      className="rounded-lg border border-neutral-300 px-2 py-1.5 text-xs max-w-[180px]"
      value={activeId ?? ""}
      onChange={(e) => void activate(e.target.value)}
      title="Active provider"
    >
      {providers.map((p) => (
        <option key={p.id} value={p.id}>
          {p.name} · {p.model}
        </option>
      ))}
    </select>
  );
}
