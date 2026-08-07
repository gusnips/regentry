import { useEffect } from "react";
import { useProvidersStore } from "./store";
import { ProviderIcon } from "./ProviderIcon";
import { PRESETS } from "../presets";
import { Button } from "@/components/Button";
import { ConfirmDialog } from "@/components/ConfirmDialog";

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
      {providers.map((p) => {
        const preset = PRESETS.find((pr) => pr.id === p.id);
        return (
          <li
            key={p.id}
            className={`flex items-center justify-between rounded-lg border px-3 py-2 ${
              p.id === activeId ? "border-brand-500 bg-brand-50" : "border-neutral-200"
            }`}
          >
            <div className="flex min-w-0 items-center gap-2.5">
              {preset ? (
                <ProviderIcon icon={preset.icon} size={24} />
              ) : (
                <span
                  className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-neutral-500 text-[10px] font-bold text-white"
                  aria-hidden
                >
                  {p.shape === "anthropic" ? "A" : "O"}
                </span>
              )}
              <div className="min-w-0">
                <div className="text-sm font-medium text-neutral-900 truncate">{p.name}</div>
                <div className="text-xs text-neutral-500 truncate">
                  {p.model} · {p.shape}
                  {p.reasoningEffort ? ` · ${p.reasoningEffort} effort` : ""}
                </div>
              </div>
            </div>
            <div className="flex shrink-0 gap-2 ml-3">
              {p.id !== activeId && (
                <Button variant="ghost" size="sm" onClick={() => void activate(p.id)}>
                  Set active
                </Button>
              )}
              <ConfirmDialog
                trigger={
                  <Button variant="ghost-danger" size="sm">
                    Remove
                  </Button>
                }
                title={`Remove ${p.name}?`}
                description="The API key stored for this provider will be deleted. You can add it again at any time."
                onConfirm={() => void remove(p.id)}
              />
            </div>
          </li>
        );
      })}
    </ul>
  );
}
