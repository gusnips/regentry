import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { MessageList, ChatInput, RunStatus, useConversationStore } from "@/modules/conversation/ui";
import {
  ProviderSelect,
  ModelControls,
  Onboarding,
  useProvidersStore,
} from "@/modules/providers/ui";
import { Button } from "@/components/Button";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { ThemeButton } from "@/components/ThemeButton";

export default function App() {
  const { t } = useTranslation();
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
    <div className="flex h-screen flex-col bg-white dark:bg-neutral-950">
      <header className="border-b border-neutral-200 px-3 pt-2 dark:border-neutral-800">
        {/* Row 1: brand + who's answering. Row 2: what it answers with. */}
        <div className="flex items-center gap-2 pb-2">
          <img src="/icon.svg" className="h-5 w-5 shrink-0" alt="Regent" />
          {needsProvider ? (
            <span className="flex-1 text-sm font-semibold text-neutral-900 dark:text-neutral-100">
              Regent
            </span>
          ) : (
            <ProviderSelect />
          )}
          {!needsProvider && (
            <ConfirmDialog
              trigger={
                <Button
                  variant="ghost"
                  size="sm"
                  className="shrink-0"
                  disabled={running}
                  title={running ? t("sidepanel.clearRunning") : t("sidepanel.clearTooltip")}
                >
                  {t("sidepanel.clear")}
                </Button>
              }
              title={t("sidepanel.clearTitle")}
              description={t("sidepanel.clearBody")}
              confirmLabel={t("sidepanel.clear")}
              onConfirm={clear}
            />
          )}
          <ThemeButton />
        </div>
        {!needsProvider && <ModelControls />}
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
