import { useLayoutEffect, useMemo, useRef, useState } from "react";
import type { ClipboardEvent, KeyboardEvent } from "react";
import { useTranslation } from "react-i18next";
import { useConversationStore } from "./store";
import { pendingAskId } from "./ask-gate";
import { toAttachment } from "./image";
import { recallStep, sentMessages } from "./history-recall";
import { expandText, insertToken, linesOf, nextToken, shouldCollapse } from "./paste-collapse";
import { RunTargetToggle } from "./RunTargetToggle";
import { TipLine } from "@/modules/tips/ui";
import { TextArea } from "@/components/TextArea";
import { Button } from "@/components/Button";
import { XIcon } from "@/components/Icon";
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
  // An unanswered ask_user turns the composer into the answer field — the
  // placeholder says so (the card's chips/hint use the same gate, ask-gate.ts).
  const questionPending = pendingAskId(messages, status) !== undefined;
  const queued = useConversationStore((s) => s.queued);
  const sendTask = useConversationStore((s) => s.sendTask);
  const queueMessage = useConversationStore((s) => s.queueMessage);
  const unqueueMessage = useConversationStore((s) => s.unqueueMessage);
  const recallQueued = useConversationStore((s) => s.recallQueued);
  const stop = useConversationStore((s) => s.stop);
  const queuedRun = useConversationStore((s) => s.queuedRun);
  const cancelQueuedRun = useConversationStore((s) => s.cancelQueuedRun);
  // The chip's position reads the board live (like RunBoard does) — entries
  // ahead of ours leaving the line move it up without a new event.
  const queuedPosition = useConversationStore((s) => {
    if (!s.queuedRun) return 0;
    const at = s.board.queue.findIndex((q) => q.id === s.queuedRun?.id);
    return at >= 0 ? at + 1 : s.queuedRun.position;
  });
  const boardRunHere = useConversationStore(
    (s) => s.activeId !== null && s.board.running?.conversationId === s.activeId,
  );
  const areaRef = useRef<HTMLTextAreaElement>(null);
  /** Monotonic, so removing #1 never lets a later paste reuse its token. */
  const imageCount = useRef(0);
  /** Position in `sentHistory` (null = editing your own draft) plus the draft
   *  that browsing stashed, so ↓ past the newest hands it straight back. */
  const browse = useRef<{ index: number | null; draft: string }>({ index: null, draft: "" });
  const sentHistory = useMemo(() => sentMessages(messages), [messages]);

  const running = status === "running";
  // Steering = typing into a run that is driving THIS conversation: either this
  // panel's own run in flight, or one the board reports here after a reopen.
  // While our own submission waits in the queue, input starts another task.
  const steering = queuedRun ? false : running || boardRunHere;
  // Composer sub-state lives in the store alongside the draft: the draft itself
  // has store-side writers (recalls, conversation resets), and those must reset
  // the collapse state too — two copies would drift.
  const pastedTexts = useConversationStore((s) => s.pastedTexts);
  const collapseDisabled = useConversationStore((s) => s.collapseDisabled);
  const addPastedText = useConversationStore((s) => s.addPastedText);
  const clearPastedTexts = useConversationStore((s) => s.clearPastedTexts);
  /** Caret a token insert asked for, applied on the next paint. */
  const pendingCaret = useRef<number | null>(null);

  // Autogrow with content, capped at ~6 rows.
  useLayoutEffect(() => {
    const el = areaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 132)}px`;
  }, [text]);

  // Restore the caret a token insert asked for — a layout effect, so it lands
  // before the browser paints the value (a plain effect would flash it at the
  // end of the text first).
  useLayoutEffect(() => {
    const el = areaRef.current;
    if (el && pendingCaret.current !== null) {
      el.setSelectionRange(pendingCaret.current, pendingCaret.current);
      pendingCaret.current = null;
    }
  }, [text]);

  /**
   * Pasted images become a "[Image #N]" token in the text plus a thumbnail.
   * The token is the handle: it lets you write "click the button in [Image #1]",
   * and deleting it drops the image from the send. Queued mid-run messages are
   * text-only, so pastes while running are explained, not swallowed.
   */
  const onPaste = async (e: ClipboardEvent<HTMLTextAreaElement>) => {
    const files = [...e.clipboardData.files].filter((f) => f.type.startsWith("image/"));
    if (files.length > 0) {
      e.preventDefault();
      if (steering) {
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
      return;
    }

    // Text paste: a big block folds into a token at the caret, its full text
    // spliced back in on send (see paste-collapse.ts). Short pastes fall
    // through to the browser's normal inline paste.
    const pasted = e.clipboardData.getData("text/plain");
    if (!pasted || collapseDisabled || !shouldCollapse(pasted)) return;
    e.preventDefault();
    const el = areaRef.current;
    const caretStart = el?.selectionStart ?? text.length;
    const caretEnd = el?.selectionEnd ?? caretStart;
    const token = nextToken(
      new Set(pastedTexts.map((p) => p.token)),
      t("chat.pasteToken", { count: linesOf(pasted) }),
    );
    // The entry lands before the text write, so setDraft's prune sees the token
    // already present and keeps it.
    addPastedText({ token, content: pasted });
    const { text: newText, caret } = insertToken(text, caretStart, caretEnd, token);
    setText(newText);
    pendingCaret.current = caret;
  };

  const removeAttachment = (token: string) => {
    setAttachments((prev) => prev.filter((a) => a.token !== token));
    setText(text.replaceAll(token, "").replace(/ {2,}/g, " ").trim());
  };

  const submit = () => {
    // Collapse tokens expand to their full text before the message goes out —
    // the model never sees a "[Pasted 5 lines]" placeholder.
    const task = expandText(text, pastedTexts).trim();
    if (!task) return;
    if (steering) {
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
    // setDraft("") above pruned everything and armed the inline override; a sent
    // message is a fresh draft, so the fold is fair game again.
    clearPastedTexts();
    setAttachError(null);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      submit();
      return;
    }
    // One backspace deletes a whole collapse token, not just its last bracket.
    if (e.key === "Backspace") {
      const el = areaRef.current;
      const caret = el?.selectionStart;
      if (el && caret !== undefined && caret === el.selectionEnd) {
        // Tokens are mutually non-suffix (see nextToken), so at most one can
        // sit right before the caret — no longest-match needed.
        const token = pastedTexts.find((p) => text.slice(0, caret).endsWith(p.token))?.token;
        if (token) {
          e.preventDefault();
          const newCaret = caret - token.length;
          setText(text.slice(0, newCaret) + text.slice(caret));
          pendingCaret.current = newCaret;
          return;
        }
      }
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
    const recall = recallStep(e.key, sentHistory, {
      ...browse.current,
      text,
      caret: areaRef.current?.selectionStart ?? text.length,
    });
    if (!recall) return;
    e.preventDefault();
    browse.current = { index: recall.index, draft: recall.draft };
    setText(recall.text);
  };

  return (
    <div className="flex flex-col gap-2 border-t border-neutral-200 p-3 dark:border-neutral-800">
      {queued.length > 0 && (
        <div className="flex flex-col gap-1">
          {queued.map((q) => (
            <div
              key={q.id}
              className="flex items-center gap-1.5 rounded-lg border border-dashed border-neutral-300 bg-neutral-50 px-2 py-1 text-xs text-neutral-600 dark:border-neutral-600 dark:bg-neutral-900 dark:text-neutral-300"
            >
              <span className="shrink-0 rounded border border-neutral-300 px-1 py-px text-[10px] font-medium dark:border-neutral-600">
                {t("chat.queuedBadge")}
              </span>
              <span className="min-w-0 flex-1 truncate">{q.text}</span>
              <button
                type="button"
                onClick={() => unqueueMessage(q.id)}
                aria-label={t("chat.unqueueAria")}
                className="flex shrink-0 items-center rounded px-1 text-neutral-500 hover:bg-neutral-100 focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:outline-none dark:text-neutral-400 dark:hover:bg-neutral-800"
              >
                <XIcon />
              </button>
            </div>
          ))}
          <p className="text-[11px] text-neutral-500 dark:text-neutral-400">
            {t("chat.queuedHint")}
          </p>
        </div>
      )}
      {queuedRun && (
        <div className="flex items-center gap-1.5 rounded-lg border border-dashed border-brand-300 bg-brand-50 px-2 py-1 text-xs text-brand-700 dark:border-brand-700 dark:bg-brand-950/40 dark:text-brand-300">
          <span className="shrink-0 rounded border border-brand-300 px-1 py-px text-[10px] font-medium dark:border-brand-700">
            {t("queue.position", { position: queuedPosition })}
          </span>
          <span className="min-w-0 flex-1 truncate" title={t("queue.queuedTitle")}>
            {queuedRun.task}
          </span>
          <button
            type="button"
            onClick={cancelQueuedRun}
            aria-label={t("queue.cancel")}
            className="flex shrink-0 items-center rounded px-1 text-brand-500 hover:bg-brand-100 focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:outline-none dark:text-brand-400 dark:hover:bg-brand-900"
          >
            <XIcon />
          </button>
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
                <XIcon />
              </button>
              <span className="mt-0.5 block text-center text-[10px] text-neutral-500 dark:text-neutral-400">
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
      {/* The tip gets the panel's full width on its own row — squeezed next to
          the run-target select it truncated to a few useless words. It stacks
          with the conditional rows above the input so the two permanent rows
          (input, footer) stay adjacent. Hidden while a run is live (the status
          band carries it then) and while the paste hint is up (one hint at a
          time, and that one is contextual). */}
      {!running && !pastedTexts.some((p) => text.includes(p.token)) && <TipLine />}
      <div className="flex items-end gap-2">
        <TextArea
          ref={areaRef}
          className="flex-1"
          rows={2}
          autoFocus
          aria-label={t("chat.inputAria")}
          placeholder={
            steering
              ? t("chat.queuePlaceholder")
              : questionPending
                ? t("chat.answerPlaceholder")
                : t("chat.placeholder")
          }
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={onKeyDown}
          onPaste={(e) => void onPaste(e)}
        />
        {steering && (
          <Button onClick={submit} disabled={!text.trim()} title={t("chat.queueTitle")}>
            {t("chat.queue")}
          </Button>
        )}
        {queuedRun ? (
          <Button onClick={submit} disabled={!text.trim()}>
            {t("chat.send")}
          </Button>
        ) : steering ? (
          <Button variant="danger" onClick={stop} title={t("chat.stopTitle")}>
            {t("chat.stop")}
          </Button>
        ) : (
          <Button onClick={submit} disabled={!text.trim()}>
            {t("chat.send")}
          </Button>
        )}
      </div>
      {/* Composer footer: the run-target toggle anchors the left (permanent, so
          the row never collapses), the paste hint takes the right when it's
          live — its coming and going never moves the control. */}
      <div className="flex items-center justify-between gap-2">
        <RunTargetToggle />
        {pastedTexts.some((p) => text.includes(p.token)) && (
          <p
            className="min-w-0 truncate text-right text-[11px] italic text-neutral-500 dark:text-neutral-400"
            title={t("chat.pasteHint")}
          >
            {t("chat.pasteHint")}
          </p>
        )}
      </div>
    </div>
  );
}
