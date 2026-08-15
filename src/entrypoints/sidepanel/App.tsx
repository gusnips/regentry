import { useEffect, useRef, useState } from "react";
import {
  MessageList,
  ChatInput,
  RunStatus,
  RunBoard,
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
import { notePanelOpen, refreshTip } from "@/modules/tips/ui";
import { Button } from "@/components/Button";
import { XIcon } from "@/components/Icon";
import { useTranslation } from "react-i18next";

/**
 * Close the panel — the run keeps going, which is the whole promise.
 *
 * Always rendered, though Chrome draws its own X right above ours: the browsers
 * that host this panel do not agree on that header (Brave draws nothing at
 * all), and `chrome.sidePanel` offers no programmatic close we could sniff to
 * know — a browser we failed to spot would leave the panel with no way out,
 * so a second X on Chrome is the price of the one X Brave needs. It takes the
 * row's end so it sits where the platform's own X does.
 */
function ClosePanelButton() {
  const { t } = useTranslation();
  return (
    <Button
      variant="ghost"
      size="sm"
      className="shrink-0 px-1.5"
      title={t("sidepanel.close")}
      aria-label={t("sidepanel.close")}
      onClick={() => window.close()}
    >
      <XIcon />
    </Button>
  );
}

export default function App() {
  const { t } = useTranslation();
  const connect = useConversationStore((s) => s.connect);
  const disconnect = useConversationStore((s) => s.disconnect);
  const stop = useConversationStore((s) => s.stop);
  // Where Esc-stop applies: this panel's run in flight (not merely queued —
  // Esc must never halt another conversation's run), or the board's run living
  // on this conversation after a reopen (status is idle then, but the Stop is
  // real). The same condition ChatInput calls "steering".
  const stopReady = useConversationStore(
    (s) =>
      (s.status === "running" && !s.queuedRun) ||
      (s.activeId !== null && s.board.running?.conversationId === s.activeId),
  );
  // Until the first message names the conversation the header says "New chat" —
  // never a blank row.
  const chatTitle = useConversationStore(
    (s) => s.conversations.find((c) => c.id === s.activeId)?.title ?? "",
  );
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
      if (e.key === "Escape" && stopReady) {
        e.preventDefault();
        stop();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [stopReady, stop]);

  useEffect(() => {
    void load(); // idempotent — the store dedupes concurrent mounts
  }, [load]);

  // Tip rotation boundaries — Claude Code re-picks per turn; our run is the
  // turn: once per panel open, then again each time a run ends. A conversation
  // switch re-fires the runEndedAt effect too, which is fine — the composer is
  // re-read then anyway, and pickTip's chain dedupes a mount/run-end race.
  const runEndedAt = useConversationStore((s) => s.runEndedAt);
  const prevRunEndedAt = useRef(runEndedAt);
  useEffect(() => {
    void notePanelOpen().then(() => refreshTip());
  }, []);
  useEffect(() => {
    if (runEndedAt === prevRunEndedAt.current) return;
    prevRunEndedAt.current = runEndedAt;
    refreshTip();
  }, [runEndedAt]);

  const needsProvider = loaded && providers.length === 0;

  return (
    <div className="flex h-screen flex-col bg-white dark:bg-neutral-950">
      <header className="border-b border-neutral-200 px-3 pt-2 dark:border-neutral-800">
        {/* Row 1: the open chat's title, then the rare utilities quiet, then the
            hot action labeled, with Close at the row's end — where the
            platform's own X sits. A duplicate on Chrome, the only way out on
            Brave (which draws no header at all): that trade is spelled out on
            the button. No brand mark: the browser's own side-panel header
            already sits directly above with our icon and name, and a second
            wordmark is duplicate chrome. Row 2: who answers and with what, as
            quiet chips — the header is read a hundred times per change. */}
        <div className="flex items-center gap-1 pb-1">
          <span
            className="min-w-0 flex-1 truncate px-2 text-sm font-medium text-neutral-700 dark:text-neutral-200"
            title={chatTitle || undefined}
          >
            {historyOpen ? "" : chatTitle || t("history.newChat")}
          </span>
          {!needsProvider && (
            <HistoryToggle open={historyOpen} onToggle={() => setHistoryOpen((v) => !v)} />
          )}
          <SettingsMenu />
          {!needsProvider && (
            <NewChatButton open={historyOpen} onToggle={() => setHistoryOpen((v) => !v)} />
          )}
          <ClosePanelButton />
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
          <RunBoard />
          <MessageList />
          <RunStatus />
          <ChatInput />
        </>
      )}
    </div>
  );
}
