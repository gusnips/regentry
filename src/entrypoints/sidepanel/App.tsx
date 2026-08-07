import { useEffect, useState } from "react";
import {
  MessageList,
  ChatInput,
  RunStatus,
  DrivenTabChip,
  ConversationList,
  HistoryToggle,
  NewChatButton,
  useConversationStore,
} from "@/modules/conversation/ui";
import {
  ProviderSelect,
  ModelControls,
  Onboarding,
  useProvidersStore,
} from "@/modules/providers/ui";
import { SettingsMenu } from "./SettingsMenu";

export default function App() {
  const connect = useConversationStore((s) => s.connect);
  const disconnect = useConversationStore((s) => s.disconnect);
  const providers = useProvidersStore((s) => s.providers);
  const loaded = useProvidersStore((s) => s.loaded);
  const load = useProvidersStore((s) => s.load);
  const [historyOpen, setHistoryOpen] = useState(false);

  useEffect(() => {
    connect();
    return () => disconnect();
  }, [connect, disconnect]);

  useEffect(() => {
    void load(); // idempotent — the store dedupes concurrent mounts
  }, [load]);

  const needsProvider = loaded && providers.length === 0;

  return (
    <div className="flex h-screen flex-col bg-white dark:bg-neutral-950">
      <header className="border-b border-neutral-200 px-3 pt-2 dark:border-neutral-800">
        {/* Row 1: brand, then the rare utilities quiet, then the hot action
            labeled at the row's end. Row 2: who answers and with what, as
            quiet chips — the header is read a hundred times per change. */}
        <div className="flex items-center gap-1 pb-1">
          <img src="/icon.svg" className="h-5 w-5 shrink-0" alt="" aria-hidden />
          <span className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">
            Regent
          </span>
          <div className="min-w-0 flex-1" />
          {!needsProvider && (
            <HistoryToggle open={historyOpen} onToggle={() => setHistoryOpen((v) => !v)} />
          )}
          <SettingsMenu />
          {!needsProvider && (
            <NewChatButton open={historyOpen} onToggle={() => setHistoryOpen((v) => !v)} />
          )}
        </div>
        {/* The chips belong to the chat — history browsing hides them. While a
            run is live the row grows the driven-tab chip, quiet like the rest. */}
        {!needsProvider && !historyOpen && (
          <div className="flex items-center gap-1 overflow-hidden pb-1.5">
            <ProviderSelect />
            <ModelControls />
            <DrivenTabChip />
          </div>
        )}
      </header>
      {needsProvider ? (
        <Onboarding />
      ) : historyOpen ? (
        <ConversationList onClose={() => setHistoryOpen(false)} />
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
