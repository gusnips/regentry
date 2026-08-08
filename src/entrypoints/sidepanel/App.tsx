import { useEffect, useState } from "react";
import {
  MessageList,
  ChatInput,
  RunStatus,
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
  const status = useConversationStore((s) => s.status);
  const stop = useConversationStore((s) => s.stop);
  const providers = useProvidersStore((s) => s.providers);
  const loaded = useProvidersStore((s) => s.loaded);
  const load = useProvidersStore((s) => s.load);
  const [historyOpen, setHistoryOpen] = useState(false);

  useEffect(() => {
    connect();
    return () => disconnect();
  }, [connect, disconnect]);

  // Esc cancels the current run from anywhere in the panel — the stop gesture,
  // which auto-sends a pending queue as the next task. A Base UI overlay's own
  // Esc-to-close wins: with a dialog/menu open, Esc never halts a run by surprise.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (
        document.querySelector(
          '[role="dialog"],[role="alertdialog"],[role="menu"],[role="listbox"]',
        )
      )
        return;
      if (e.key === "Escape" && status === "running") {
        e.preventDefault();
        stop();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [status, stop]);

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
            Regentry
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
        {/* The task controls belong to the chat — history browsing hides them.
            The driven tab lives on the live run band, not here: it is run
            context, and four variable-width items never fit this row. */}
        {!needsProvider && !historyOpen && (
          <div className="flex items-center gap-1 overflow-hidden pb-1.5">
            <ProviderSelect />
            <ModelControls />
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
