import { AddProviderDialog } from "./AddProviderDialog";
import { Button } from "@/components/Button";

/** First-run home — shown in the side panel while no provider is configured. */
export function Onboarding() {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center">
      <img src="/icon.svg" className="h-12 w-12" alt="" />
      <div className="text-base font-semibold text-neutral-900 dark:text-neutral-100">
        Welcome to Regent
      </div>
      <p className="max-w-[280px] text-sm text-neutral-600 dark:text-neutral-400">
        An AI agent that drives this browser — your tabs, your sessions, your logins — to get tasks
        done.
      </p>
      <p className="max-w-[280px] text-xs text-neutral-500 dark:text-neutral-400">
        To start, connect a provider. Your API key stays on this device and goes straight to the
        provider — there is no Regent server.
      </p>
      <AddProviderDialog trigger={<Button className="mt-1">Add a provider</Button>} />
      <p className="text-xs text-neutral-400 dark:text-neutral-500">
        12 presets — Anthropic, OpenAI, Kimi, Z.ai, Ollama… — or any compatible endpoint.
      </p>
    </div>
  );
}
