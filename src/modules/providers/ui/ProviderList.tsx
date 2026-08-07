import { useEffect } from "react";
import { useProvidersStore } from "./store";

export function ProviderList() {
  const { providers, activeId, loaded, load, remove, activate } = useProvidersStore();

  useEffect(() => {
    if (!loaded) void load();
  }, [loaded, load]);

  if (!loaded) return null;

  if (providers.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-neutral-300 p-6 text-center">
        <div className="text-sm font-medium text-neutral-700">No providers yet</div>
        <p className="mt-1 text-xs text-neutral-500">
          Add your first provider below — pick a preset or point at any OpenAI/Anthropic-compatible
          endpoint.
        </p>
      </div>
    );
  }

  return (
    <ul className="flex flex-col gap-2">
      {providers.map((p) => (
        <li
          key={p.id}
          className={`flex items-center justify-between rounded-lg border px-3 py-2 ${
            p.id === activeId ? "border-blue-500 bg-blue-50" : "border-neutral-200"
          }`}
        >
          <div className="min-w-0">
            <div className="text-sm font-medium text-neutral-900 truncate">{p.name}</div>
            <div className="text-xs text-neutral-500 truncate">
              {p.model} · {p.shape} · {p.baseUrl}
            </div>
          </div>
          <div className="flex shrink-0 gap-2 ml-3">
            {p.id !== activeId && (
              <button
                className="text-xs text-blue-600 hover:underline"
                onClick={() => void activate(p.id)}
              >
                Set active
              </button>
            )}
            <button
              className="text-xs text-red-600 hover:underline"
              onClick={() => void remove(p.id)}
            >
              Remove
            </button>
          </div>
        </li>
      ))}
    </ul>
  );
}
