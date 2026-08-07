import { useEffect } from "react";
import { MessageList, ChatInput, useConversationStore } from "@/modules/conversation/ui";
import { ModelPicker } from "@/modules/providers/ui";

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
        <span className="text-sm font-semibold text-neutral-900">Regent</span>
        <div className="flex items-center gap-2">
          <ModelPicker />
          <button
            className="rounded-lg px-2 py-1.5 text-xs text-neutral-500 hover:bg-neutral-100"
            onClick={clear}
            title="Clear conversation"
          >
            Clear
          </button>
        </div>
      </header>
      <MessageList />
      <ChatInput />
    </div>
  );
}
