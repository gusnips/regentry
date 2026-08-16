import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useConversationStore } from "./store";
import type { ConversationMeta } from "../conversations";
import { describeRecurrence, type Schedule } from "@/modules/schedule";
import { useSchedules } from "@/modules/schedule/ui";
import { Button } from "@/components/Button";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { Icon } from "@/components/Icon";
import { TitleInput } from "./TitleInput";

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

function PencilIcon() {
  return (
    <Icon>
      <path d="M17 3a2.8 2.8 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" />
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
  schedule,
  onOpen,
  onDelete,
}: {
  conversation: ConversationMeta;
  active: boolean;
  /** Set when a schedule writes into this thread — deleting it ends that too. */
  schedule?: Schedule;
  onOpen: () => void;
  onDelete: () => void;
}) {
  const { t, i18n } = useTranslation();
  const renameConversation = useConversationStore((s) => s.renameConversation);
  const [editing, setEditing] = useState(false);
  const title = conversation.title || t("history.untitled");
  return (
    <div
      className={`group flex items-center gap-1 rounded-lg px-2 py-1.5 ${
        active
          ? "bg-brand-50 dark:bg-brand-950/40"
          : "hover:bg-neutral-100 dark:hover:bg-neutral-800"
      }`}
    >
      {editing ? (
        // Swapped IN for the open button rather than nested inside it — an
        // <input> in a <button> is invalid markup and eats its own clicks.
        <TitleInput
          value={conversation.title}
          placeholder={t("history.renamePlaceholder")}
          aria-label={t("history.rename")}
          onCommit={(next) => {
            renameConversation(conversation.id, next);
            setEditing(false);
          }}
          onCancel={() => setEditing(false)}
          className="flex-1 text-sm text-neutral-800 dark:text-neutral-100"
        />
      ) : (
        <>
          <button
            type="button"
            onClick={onOpen}
            className="min-w-0 flex-1 cursor-pointer rounded text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-1 focus-visible:ring-offset-white dark:focus-visible:ring-offset-neutral-950"
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
                  {/* The chip reads the same either way; the accessible name
                      must not — a scheduled thread never came over MCP. */}
                  <span className="sr-only">
                    {conversation.scheduled
                      ? t("history.ranOnSchedule")
                      : t("history.drivenBy", { agent: conversation.agent })}
                  </span>
                  <span
                    aria-hidden
                    className="size-1.5 shrink-0 rounded-full bg-neutral-300 dark:bg-neutral-600"
                  />
                  <span
                    aria-hidden
                    className="shrink-0 font-medium text-brand-600 dark:text-brand-400"
                  >
                    {conversation.agent}
                  </span>
                  <span aria-hidden>·</span>
                </>
              )}
              <span className="truncate">
                {/* No count on a thread that has none to show (an MCP thread opened
                    but not yet driven, a row written before the count meant tasks) —
                    "0 tasks" says less than the time alone. */}
                {conversation.taskCount
                  ? `${t("history.tasks", { count: conversation.taskCount })} · `
                  : ""}
                {relativeTime(conversation.updatedAt, i18n.language)}
              </span>
            </div>
          </button>
          <Button
            variant="ghost"
            size="sm"
            className="shrink-0 px-1.5 opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
            title={t("history.rename")}
            aria-label={t("history.renameAria", { title })}
            onClick={() => setEditing(true)}
          >
            <PencilIcon />
          </Button>
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
            // A scheduled thread is not just a transcript — it is the memory its
            // next fire reads back, so deleting it stops the schedule. Say which
            // one, in its own words, before the click that ends it.
            description={
              schedule
                ? t("history.deleteScheduledBody", {
                    recurrence: describeRecurrence(schedule.recurrence),
                  })
                : t("history.deleteBody")
            }
            confirmLabel={t("history.delete")}
            onConfirm={onDelete}
          />
        </>
      )}
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
  // Keyed by thread, because that is how the rows ask the question. A schedule
  // always owns its own conversation, so one entry per key.
  const scheduleFor = new Map(useSchedules().map((s) => [s.conversationId, s]));

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
              schedule={scheduleFor.get(c.id)}
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
