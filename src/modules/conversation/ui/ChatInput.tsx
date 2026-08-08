import { useEffect, useMemo, useRef, useState } from "react";
import type { ClipboardEvent, KeyboardEvent } from "react";
import { useTranslation } from "react-i18next";
import { useConversationStore } from "./store";
import { toAttachment } from "./image";
import { recallStep, sentMessages } from "./history-recall";
import { TextArea } from "@/components/TextArea";
import { Button } from "@/components/Button";
import { ZoomableImage } from "@/components/ZoomableImage";

interface Attachment {
  /** The "[Image #1]" token that stands in for this image inside the task text. */
  token: string;
  dataUrl: string;
}

export function ChatInput() {
  const { t } = useTranslation();
  // The draft lives in the store: a recalled queue or an ending run writes
  // straight into the composer, no effect needed to ferry it over.
  const text = useConversationStore((s) => s.draft);
  const setText = useConversationStore((s) => s.setDraft);
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [attachError, setAttachError] = useState<string | null>(null);
  const status = useConversationStore((s) => s.status);
  const messages = useConversationStore((s) => s.messages);
  const queued = useConversationStore((s) => s.queued);
  const sendTask = useConversationStore((s) => s.sendTask);
  const queueMessage = useConversationStore((s) => s.queueMessage);
  const unqueueMessage = useConversationStore((s) => s.unqueueMessage);
  const recallQueued = useConversationStore((s) => s.recallQueued);
  const stop = useConversationStore((s) => s.stop);
  const areaRef = useRef<HTMLTextAreaElement>(null);
  /** Monotonic, so removing #1 never lets a later paste reuse its token. */
  const imageCount = useRef(0);
  /** Position in `sentHistory` while browsing it; null = editing a fresh draft. */
  const historyIndex = useRef<number | null>(null);
  const sentHistory = useMemo(() => sentMessages(messages), [messages]);

  const running = status === "running";

  // Autogrow with content, capped at ~6 rows
  useEffect(() => {
    const el = areaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 132)}px`;
  }, [text]);

  /**
   * Pasted images become a "[Image #N]" token in the text plus a thumbnail.
   * The token is the handle: it lets you write "click the button in [Image #1]",
   * and deleting it drops the image from the send. Queued mid-run messages are
   * text-only, so pastes while running are explained, not swallowed.
   */
  const onPaste = async (e: ClipboardEvent<HTMLTextAreaElement>) => {
    const files = [...e.clipboardData.files].filter((f) => f.type.startsWith("image/"));
    if (files.length === 0) return;
    e.preventDefault();
    if (running) {
      setAttachError(t("chat.queueNoImages"));
      return;
    }
    setAttachError(null);
    try {
      // Tokens number in paste order (assigned before the first await); the
      // downscale/encode work itself races — an N-image paste is not N× slower.
      const added = await Promise.all(
        files.map(async (file) => ({
          token: `[Image #${++imageCount.current}]`,
          dataUrl: await toAttachment(file),
        })),
      );
      setAttachments((prev) => [...prev, ...added]);
      setText([text.trimEnd(), ...added.map((a) => a.token)].filter(Boolean).join(" "));
    } catch {
      setAttachError(t("chat.attachFailed"));
    }
  };

  const removeAttachment = (token: string) => {
    setAttachments((prev) => prev.filter((a) => a.token !== token));
    setText(text.replaceAll(token, "").replace(/ {2,}/g, " ").trim());
  };

  const submit = () => {
    const task = text.trim();
    if (!task) return;
    if (running) {
      // Inserted between the next tool batches, never mid-stream.
      queueMessage(task);
    } else {
      // Only images whose token survived in the text are sent — deleting the
      // reference is how you take an image back out.
      const images = attachments.filter((a) => task.includes(a.token)).map((a) => a.dataUrl);
      sendTask(task, images);
      setAttachments([]);
    }
    setText("");
    setAttachError(null);
  };

  /** Typing ends the browse: ↑ must never overwrite text you just wrote. */
  const onChangeText = (value: string) => {
    historyIndex.current = null;
    setText(value);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      submit();
      return;
    }
    if (e.key !== "ArrowUp" && e.key !== "ArrowDown") return;
    // ↑ recalls the newest queued line first: it is still unsent, so it is the
    // most likely thing you meant to edit. Once the queue is empty ↑ walks back
    // through what you already sent, ↓ walks forward and out.
    if (e.key === "ArrowUp" && !text && queued.length > 0) {
      e.preventDefault();
      recallQueued();
      return;
    }
    const recall = recallStep(e.key, historyIndex.current, text, sentHistory);
    if (!recall) return;
    e.preventDefault();
    historyIndex.current = recall.index;
    setText(recall.text);
  };

  return (
    <div className="flex flex-col gap-2 border-t border-neutral-200 p-3 dark:border-neutral-800">
      {queued.length > 0 && (
        <div className="flex flex-col gap-1">
          {queued.map((q) => (
            <div
              key={q.id}
              className="flex items-center gap-1.5 rounded-lg border border-dashed border-brand-300 bg-brand-50/60 px-2 py-1 text-xs text-brand-800 dark:border-brand-800 dark:bg-brand-950/40 dark:text-brand-200"
            >
              <span className="shrink-0 rounded border border-brand-300 px-1 py-px text-[10px] font-medium dark:border-brand-800">
                {t("chat.queuedBadge")}
              </span>
              <span className="min-w-0 flex-1 truncate">{q.text}</span>
              <button
                type="button"
                onClick={() => unqueueMessage(q.id)}
                aria-label={t("chat.unqueueAria")}
                className="shrink-0 rounded px-1 text-brand-700 hover:bg-brand-100 focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:outline-none dark:text-brand-300 dark:hover:bg-brand-900"
              >
                ✕
              </button>
            </div>
          ))}
          <p className="text-[11px] text-neutral-400 dark:text-neutral-500">
            {t("chat.queuedHint")}
          </p>
        </div>
      )}
      {attachments.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {attachments.map((a) => (
            <div key={a.token} className="relative">
              <ZoomableImage
                src={a.dataUrl}
                alt={a.token}
                caption={a.token.replace(/[[\]]/g, "")}
                className="h-14 w-14 rounded border border-neutral-200 object-cover dark:border-neutral-700"
              />
              <button
                type="button"
                onClick={() => removeAttachment(a.token)}
                aria-label={t("chat.removeAttachment", { token: a.token })}
                className="absolute -top-1.5 -right-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-neutral-800 text-xs text-white shadow hover:bg-neutral-900 focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:outline-none dark:bg-neutral-200 dark:text-neutral-900 dark:hover:bg-white"
              >
                ✕
              </button>
              <span className="mt-0.5 block text-center text-[10px] text-neutral-400 dark:text-neutral-500">
                {a.token.replace(/[[\]]/g, "")}
              </span>
            </div>
          ))}
        </div>
      )}
      {attachError && (
        <p role="alert" className="text-xs text-red-600 dark:text-red-400">
          {attachError}
        </p>
      )}
      <div className="flex items-end gap-2">
        <TextArea
          ref={areaRef}
          className="flex-1"
          rows={2}
          autoFocus
          aria-label={t("chat.inputAria")}
          placeholder={running ? t("chat.queuePlaceholder") : t("chat.placeholder")}
          value={text}
          onChange={(e) => onChangeText(e.target.value)}
          onKeyDown={onKeyDown}
          onPaste={(e) => void onPaste(e)}
        />
        {running && (
          <Button onClick={submit} disabled={!text.trim()} title={t("chat.queueTitle")}>
            {t("chat.queue")}
          </Button>
        )}
        {running ? (
          <Button variant="danger" onClick={stop}>
            {t("chat.stop")}
          </Button>
        ) : (
          <Button onClick={submit} disabled={!text.trim()}>
            {t("chat.send")}
          </Button>
        )}
      </div>
    </div>
  );
}
