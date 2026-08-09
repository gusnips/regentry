import { useTranslation } from "react-i18next";
import { useConversationStore } from "./store";
import { focusTab } from "@/modules/browser";
import { Button } from "@/components/Button";
import { Icon, XIcon } from "@/components/Icon";

function JumpIcon() {
  return (
    <Icon>
      <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
      <path d="M15 3h6v6M10 14 21 3" />
    </Icon>
  );
}

function StopIcon() {
  return (
    <Icon>
      <rect x="6" y="6" width="12" height="12" rx="2" />
    </Icon>
  );
}

/**
 * What TabRunner is doing anywhere — the running task and the line behind it.
 * Dispatch-and-forget means the action usually lives elsewhere (a background
 * tab, the floating widget), so the panel names it here: jump to the tab, stop
 * the run, cancel a waiter. Reads the same run board the widget paints from,
 * so the two can never disagree. Hidden when idle — no empty chrome.
 */
export function RunBoard() {
  const { t } = useTranslation();
  const board = useConversationStore((s) => s.board);
  const stop = useConversationStore((s) => s.stop);
  const cancelQueuedById = useConversationStore((s) => s.cancelQueuedById);

  if (!board.running && board.queue.length === 0) return null;
  const running = board.running;

  return (
    <section
      aria-label={t("board.title")}
      className="flex flex-col gap-1 border-b border-neutral-100 px-3 py-2 dark:border-neutral-800"
    >
      {running && (
        <div className="flex items-center gap-1.5">
          {running.awaiting ? (
            // Blocked on the user's answer — the still "?", never the pulse.
            <span
              aria-hidden
              title={t("run.awaitingApproval")}
              className="grid size-3.5 shrink-0 place-items-center rounded-full bg-amber-400 text-[10px] font-bold leading-none text-amber-950"
            >
              ?
            </span>
          ) : (
            /* The same pulsing amber the widget and the favicon dot speak. */
            <span
              aria-hidden
              className="size-1.5 shrink-0 animate-pulse rounded-full bg-amber-400"
            />
          )}
          <span
            className="min-w-0 flex-1 truncate text-xs font-medium text-neutral-800 dark:text-neutral-100"
            title={running.task}
          >
            {running.task}
          </span>
          {running.tabId !== undefined && (
            <Button
              variant="ghost"
              size="sm"
              className="shrink-0 px-1.5"
              title={t("board.jump")}
              aria-label={t("board.jump")}
              onClick={() => void focusTab(running.tabId as number)}
            >
              <JumpIcon />
            </Button>
          )}
          <Button
            variant="ghost-danger"
            size="sm"
            className="shrink-0 px-1.5"
            title={t("board.stop")}
            aria-label={t("board.stop")}
            onClick={stop}
          >
            <StopIcon />
          </Button>
        </div>
      )}
      {board.queue.map((q, i) => (
        <div key={q.id} className="flex items-center gap-1.5">
          <span
            aria-hidden
            className="shrink-0 rounded border border-neutral-300 px-1 py-px text-[10px] font-medium text-neutral-500 dark:border-neutral-600 dark:text-neutral-400"
          >
            {i + 1}
          </span>
          <span
            className="min-w-0 flex-1 truncate text-xs text-neutral-500 dark:text-neutral-400"
            title={q.task}
          >
            {q.task}
          </span>
          {q.owner === "panel" && (
            <Button
              variant="ghost"
              size="sm"
              className="shrink-0 px-1.5"
              title={t("board.cancel")}
              aria-label={t("board.cancel")}
              onClick={() => cancelQueuedById(q.id)}
            >
              <XIcon />
            </Button>
          )}
        </div>
      ))}
    </section>
  );
}
