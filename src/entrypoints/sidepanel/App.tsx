import { useEffect } from "react";
import { MessageList, ChatInput, RunStatus, useConversationStore } from "@/modules/conversation/ui";
import { ModelPicker } from "@/modules/providers/ui";
import { Button } from "@/components/Button";

export default function App() {
  const connect = useConversationStore((s) => s.connect);
  const disconnect = useConversationStore((s) => s.disconnect);
  const clear = useConversationStore((s) => s.clear);

  useEffect(() => {
    connect();
    return () => disconnect();
  }, [connect, disconnect]);

  return (
    <div className="flex h-screen flex-col bg-white">
      <header className="flex items-center justify-between border-b border-neutral-200 px-3 py-2">
        <span className="flex items-center gap-2">
          <img src="/icon.svg" className="h-5 w-5" alt="" />
          <span className="text-sm font-semibold text-neutral-900">Regent</span>
        </span>
        <div className="flex items-center gap-2">
          <ModelPicker />
          <Button variant="ghost" size="sm" onClick={clear} title="Clear conversation">
            Clear
          </Button>
        </div>
      </header>
      <MessageList />
      <RunStatus />
      <ChatInput />
    </div>
  );
}
