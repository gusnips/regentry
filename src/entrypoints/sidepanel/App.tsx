import { useEffect } from "react";
import { MessageList, ChatInput, RunStatus, useConversationStore } from "@/modules/conversation/ui";
import { ModelPicker, Onboarding, useProvidersStore } from "@/modules/providers/ui";
import { Button } from "@/components/Button";
import { ConfirmDialog } from "@/components/ConfirmDialog";

export default function App() {
  const connect = useConversationStore((s) => s.connect);
  const disconnect = useConversationStore((s) => s.disconnect);
  const clear = useConversationStore((s) => s.clear);
  const status = useConversationStore((s) => s.status);
  const providers = useProvidersStore((s) => s.providers);
  const loaded = useProvidersStore((s) => s.loaded);
  const load = useProvidersStore((s) => s.load);

  useEffect(() => {
    connect();
    return () => disconnect();
  }, [connect, disconnect]);

  useEffect(() => {
    if (!loaded) void load();
  }, [loaded, load]);

  const needsProvider = loaded && providers.length === 0;
  const running = status === "running";

  return (
    <div className="flex h-screen flex-col bg-white">
      <header className="flex items-center justify-between border-b border-neutral-200 px-3 py-2">
        <span className="flex items-center gap-2">
          <img src="/icon.svg" className="h-5 w-5" alt="" />
          <span className="text-sm font-semibold text-neutral-900">Regent</span>
        </span>
        {!needsProvider && (
          <div className="flex items-center gap-2">
            <ModelPicker />
            <ConfirmDialog
              trigger={
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={running}
                  title={running ? "Stop the run before clearing" : "Clear conversation"}
                >
                  Clear
                </Button>
              }
              title="Clear conversation?"
              description="This wipes the visible transcript stored on this device. The agent keeps no memory between tasks — clearing only affects what you see here."
              confirmLabel="Clear"
              onConfirm={clear}
            />
          </div>
        )}
      </header>
      {needsProvider ? (
        <Onboarding />
      ) : (
        <>
          <MessageList />
          <RunStatus />
          <ChatInput />
        </>
      )}
    </div>
  );
}
