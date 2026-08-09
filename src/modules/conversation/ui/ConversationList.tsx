import { useTranslation } from "react-i18next";
import { useConversationStore } from "./store";
import type { ConversationMeta } from "../conversations";
import { Button } from "@/components/Button";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { Icon } from "@/components/Icon";

function BackIcon() {
  return (
    <Icon>
      <path d="M19 12H5m7-7-7 7 7 7" />
    </Icon>
  );
}

function PlusIcon() {
  return (
    <Icon>
      <path d="M12 5v14M5 12h14" />
    </Icon>
  );
}

function TrashIcon() {
  return (
    <Icon>
      <path d="M3 6h18M8 6V4h8v2m-9 0 1 14h8l1-14" />
    </Icon>
  );
}

function HistoryIcon() {
  return (
    <Icon>
      <path d="M3 12a9 9 0 1 0 3-6.7L3 8" />
      <path d="M3 3v5h5M12 7v5l3.5 2" />
    </Icon>
  );
}

/** Quiet icon toggle to browse the stored transcripts. */
export function HistoryToggle({ open, onToggle }: { open: boolean; onToggle: () => void }) {
  const { t } = useTranslation();
  const running = useConversationStore((s) => s.status === "running");
  // Switching transcripts mid-run would misroute the stream — finish or stop first.
  const busyTitle = running ? t("sidepanel.busyRunning") : undefined;

  return (
    <Button
      variant="ghost"
      size="sm"
      className={`shrink-0 px-1.5 ${open ? "bg-neutral-100 dark:bg-neutral-800" : ""}`}
      disabled={running}
      aria-pressed={open}
      title={busyTitle ?? t("history.title")}
      aria-label={t("history.title")}
      onClick={onToggle}
    >
      <HistoryIcon />
    </Button>
  );
}

/**
 * The panel's most-used action, so it gets the row's end slot, a label, and the
 * outline weight — the rare utilities sit together to its left, quiet.
 */
export function NewChatButton({ open, onToggle }: { open: boolean; onToggle: () => void }) {
  const { t } = useTranslation();
  const running = useConversationStore((s) => s.status === "running");
  const newConversation = useConversationStore((s) => s.newConversation);
  // Only emptiness matters here — select the boolean, not the whole array.
  const empty = useConversationStore((s) => s.messages.length === 0);
  const busyTitle = running ? t("sidepanel.busyRunning") : undefined;

  return (
    <Button
      variant="outline"
      size="sm"
      className="ml-1 flex shrink-0 items-center gap-1"
      disabled={running || (empty && !open)}
      title={busyTitle ?? t("history.newChat")}
      onClick={() => {
        newConversation();
        if (open) onToggle();
      }}
    >
      <PlusIcon />
      {t("history.newChat")}
    </Button>
  );
}

/** "2 hours ago" / "yesterday" — Intl does the locale work, no date library. */
function relativeTime(ts: number, locale: string): string {
  const units: [Intl.RelativeTimeFormatUnit, number][] = [
    ["day", 86_400_000],
    ["hour", 3_600_000],
    ["minute", 60_000],
  ];
  const diff = ts - Date.now();
  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: "auto" });
  for (const [unit, ms] of units) {
    if (Math.abs(diff) >= ms) return rtf.format(Math.round(diff / ms), unit);
  }
  return rtf.format(0, "second");
}

function ConversationRow({
  conversation,
  active,
  onOpen,
  onDelete,
}: {
  conversation: ConversationMeta;
  active: boolean;
  onOpen: () => void;
  onDelete: () => void;
}) {
  const { t, i18n } = useTranslation();
  const title = conversation.title || t("history.untitled");
  return (
    <div
      className={`group flex items-center gap-1 rounded-lg px-2 py-1.5 ${
        active
          ? "bg-brand-50 dark:bg-brand-950/40"
          : "hover:bg-neutral-100 dark:hover:bg-neutral-800"
      }`}
    >
      <button
        type="button"
        onClick={onOpen}
        className="min-w-0 flex-1 cursor-pointer text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-1 rounded"
      >
        <div
          className={`truncate text-sm ${
            active
              ? "font-medium text-brand-700 dark:text-brand-300"
              : "text-neutral-800 dark:text-neutral-100"
          }`}
        >
          {title}
        </div>
        <div className="mt-0.5 flex items-center gap-1 truncate text-xs text-neutral-500 dark:text-neutral-400">
          {conversation.agent && (
            <>
              {/* Amber is this product's "an agent is working" language — the
                  same colour as the on-page badge's dot and the favicon pulse. */}
              <span className="sr-only">
                {t("history.drivenBy", { agent: conversation.agent })}
              </span>
              <span aria-hidden className="size-1.5 shrink-0 rounded-full bg-amber-400" />
              <span aria-hidden className="shrink-0 font-medium text-brand-600 dark:text-brand-400">
                {conversation.agent}
              </span>
              <span aria-hidden>·</span>
            </>
          )}
          <span className="truncate">
            {t("history.messages", { count: conversation.messageCount })} ·{" "}
            {relativeTime(conversation.updatedAt, i18n.language)}
          </span>
        </div>
      </button>
      <ConfirmDialog
        trigger={
          <Button
            variant="ghost-danger"
            size="sm"
            className="shrink-0 px-1.5 opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
            title={t("history.delete")}
            aria-label={t("history.deleteAria", { title })}
          >
            <TrashIcon />
          </Button>
        }
        title={t("history.deleteTitle")}
        description={t("history.deleteBody")}
        confirmLabel={t("history.delete")}
        onConfirm={onDelete}
      />
    </div>
  );
}

/** Stored transcripts, newest first — opens one in the panel, or starts a fresh one. */
export function ConversationList({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation();
  const conversations = useConversationStore((s) => s.conversations);
  const activeId = useConversationStore((s) => s.activeId);
  const openConversation = useConversationStore((s) => s.openConversation);
  const newConversation = useConversationStore((s) => s.newConversation);
  const removeConversation = useConversationStore((s) => s.removeConversation);

  const startNew = () => {
    newConversation();
    onClose();
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center gap-2 border-b border-neutral-100 px-2 py-1.5 dark:border-neutral-800">
        <Button variant="ghost" size="sm" className="flex items-center gap-1.5" onClick={onClose}>
          <BackIcon />
          {t("history.title")}
        </Button>
      </div>

      {conversations.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-2 p-6 text-center">
          <div className="text-sm font-medium text-neutral-700 dark:text-neutral-200">
            {t("history.emptyTitle")}
          </div>
          <p className="max-w-[240px] text-xs text-neutral-500 dark:text-neutral-400">
            {t("history.emptyBody")}
          </p>
          <Button size="sm" className="mt-2" onClick={startNew}>
            {t("history.emptyAction")}
          </Button>
        </div>
      ) : (
        <div className="flex flex-1 flex-col gap-0.5 overflow-y-auto p-1.5">
          {conversations.map((c) => (
            <ConversationRow
              key={c.id}
              conversation={c}
              active={c.id === activeId}
              onOpen={() => {
                openConversation(c.id);
                onClose();
              }}
              onDelete={() => removeConversation(c.id)}
            />
          ))}
          <p className="mt-2 px-2 pb-1 text-center text-xs text-neutral-500 dark:text-neutral-400">
            {t("history.storedNote")}
          </p>
        </div>
      )}
    </div>
  );
}
