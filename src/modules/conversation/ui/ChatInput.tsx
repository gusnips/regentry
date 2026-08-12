import { useLayoutEffect, useMemo, useRef, useState } from "react";
import type { ClipboardEvent, KeyboardEvent } from "react";
import { useTranslation } from "react-i18next";
import { useConversationStore } from "./store";
import { pendingAskId } from "./ask-gate";
import { toAttachment } from "./image";
import { recallStep, sentMessages } from "./history-recall";
import { expandText, insertToken, linesOf, nextToken, shouldCollapse } from "./paste-collapse";
import { RunTargetToggle } from "./RunTargetToggle";
import { SlashMenu } from "./SlashMenu";
import { COMMANDS, executeSlash, slashItems } from "./slash-commands";
import type { SlashItem } from "./slash-commands";
import { TipLine } from "@/modules/tips/ui";
import { TextArea } from "@/components/TextArea";
import { Button } from "@/components/Button";
import { Icon, XIcon } from "@/components/Icon";
import { ZoomableImage } from "@/components/ZoomableImage";

interface Attachment {
  /** The "[Image #1]" token that stands in for this image inside the task text. */
  token: string;
  dataUrl: string;
}

/** The send glyph — arrow up, the agentic-composer idiom. */
function SendIcon() {
  return (
    <Icon>
      <path d="M12 19V5" />
      <path d="m5 12 7-7 7 7" />
    </Icon>
  );
}

/** Filled square — stop, solid on the danger circle. */
function StopIcon() {
  return (
    <Icon>
      <rect x="7" y="7" width="10" height="10" rx="2" fill="currentColor" stroke="none" />
    </Icon>
  );
}

/**
 * A committed item waiting its turn — the dashed one-liner this replaced read
 * as a draft. The amber accent bar is the panel's parked/waiting language (the
 * awaiting dot, the board's "?"), the chip numbers the line like the run board
 * does, and two lines of text beat a truncated one.
 */
function QueueCard({
  chip,
  title,
  text,
  onRemove,
  removeAria,
}: {
  chip: string;
  title: string;
  text: string;
  onRemove: () => void;
  removeAria: string;
}) {
  return (
    <div className="flex items-start gap-2 rounded-lg border border-neutral-200 border-l-2 border-l-amber-400 bg-neutral-50 px-2.5 py-1.5 dark:border-neutral-800 dark:border-l-amber-500 dark:bg-neutral-900">
      <span
        title={title}
        className="mt-px shrink-0 rounded border border-amber-300 px-1 py-px text-[10px] font-medium text-amber-700 dark:border-amber-700 dark:text-amber-300"
      >
        {chip}
      </span>
      <span
        title={text}
        className="min-w-0 flex-1 line-clamp-2 text-xs text-neutral-700 dark:text-neutral-300"
      >
        {text}
      </span>
      <button
        type="button"
        onClick={onRemove}
        aria-label={removeAria}
        className="flex shrink-0 items-center rounded px-1 text-neutral-500 hover:bg-neutral-100 focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:outline-none dark:text-neutral-400 dark:hover:bg-neutral-800"
      >
        <XIcon />
      </button>
    </div>
  );
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
  const bridgeActive = useConversationStore((s) => s.bridgeActive);
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
  // The composer's one button is a single morphing slot (the agentic-IDE idiom):
  // ■ Stop appears only while a live run owns this conversation AND the input is
  // empty — the moment there's text, ↑ Send/Queue takes the slot back, so the
  // two never compete for the same click.
  const stopVisible = steering && !text.trim();
  // Composer sub-state lives in the store alongside the draft: the draft itself
  // has store-side writers (recalls, conversation resets), and those must reset
  // the collapse state too — two copies would drift.
  const pastedTexts = useConversationStore((s) => s.pastedTexts);
  const collapseDisabled = useConversationStore((s) => s.collapseDisabled);
  const addPastedText = useConversationStore((s) => s.addPastedText);
  const clearPastedTexts = useConversationStore((s) => s.clearPastedTexts);
  /** Caret a token insert asked for, applied on the next paint. */
  const pendingCaret = useRef<number | null>(null);

  // Slash commands: the menu state derives from the draft ("/" first, one
  // line). Esc dismisses until the next edit; the highlight lands on the
  // current value and resets whenever the item list changes. Render-time
  // adjustment, like the plan card's — no effects ferrying keystrokes.
  const slash = useMemo(() => slashItems(text), [text]);
  const slashKey = slash?.items.map((i) => i.key).join(" ") ?? "";
  const [slashState, setSlashState] = useState({ key: "", index: 0 });
  if (slashState.key !== slashKey) {
    // A picker opens with its current value highlighted — Enter untouched is a no-op.
    const current = slash?.items.findIndex((i) => i.current) ?? -1;
    setSlashState({ key: slashKey, index: current >= 0 ? current : 0 });
  }
  const [slashDismissedFor, setSlashDismissedFor] = useState<string | null>(null);
  if (slashDismissedFor !== null && slashDismissedFor !== text) setSlashDismissedFor(null);
  const slashOpen = slash !== null && slash.items.length > 0 && slashDismissedFor === null;
  const slashIndex = Math.min(slashState.index, Math.max(0, (slash?.items.length ?? 1) - 1));
  const slashActive = slashOpen && slash ? slash.items[slashIndex] : undefined;

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

  /** A sent message (or a fired command) leaves a pristine composer. */
  const resetComposer = () => {
    setText("");
    // setDraft("") above pruned everything and armed the inline override; a sent
    // message is a fresh draft, so the fold is fair game again.
    clearPastedTexts();
    setAttachError(null);
    setAttachments([]);
  };

  /** Click/Enter on a menu row: a candidate runs its command with the row's
   *  value; a command row fires at once when it takes no argument, and
   *  completes into the draft otherwise so its picker can open. */
  const acceptSlash = (item: SlashItem) => {
    if (!slash) return;
    if (slash.kind === "candidates") {
      slash.command.run(item.key);
      resetComposer();
      return;
    }
    const command = COMMANDS.find((c) => c.name === item.key);
    if (!command) return;
    if (command.takesArg) {
      setText(`/${command.name} `);
    } else {
      command.run(undefined);
      resetComposer();
    }
  };

  const submit = () => {
    // Collapse tokens expand to their full text before the message goes out —
    // the model never sees a "[Pasted 5 lines]" placeholder.
    const task = expandText(text, pastedTexts).trim();
    if (!task) return;
    // A leading "/" is a local command — it runs against the panel's stores
    // and never reaches the model, not even as mid-run steering.
    const outcome = executeSlash(task);
    if (outcome !== "not-slash") {
      if (outcome === "executed") resetComposer();
      else setText(outcome.complete);
      return;
    }
    if (steering) {
      // Inserted between the next tool batches, never mid-stream.
      queueMessage(task);
    } else {
      // Only images whose token survived in the text are sent — deleting the
      // reference is how you take an image back out.
      const images = attachments.filter((a) => task.includes(a.token)).map((a) => a.dataUrl);
      sendTask(task, images);
    }
    resetComposer();
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    // An open slash menu owns the keys — its arrows/Tab/Enter/Esc never reach
    // history recall or submit.
    if (slashOpen && slash) {
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        const delta = e.key === "ArrowDown" ? 1 : -1;
        setSlashState({
          key: slashKey,
          index: Math.min(Math.max(slashIndex + delta, 0), slash.items.length - 1),
        });
        return;
      }
      if (e.key === "Tab") {
        // Completion without execution: the command name (plus its arg space),
        // or the highlighted candidate swapped in for the typed arg.
        e.preventDefault();
        if (!slashActive) return;
        if (slash.kind === "candidates") {
          setText(`/${slash.command.name} ${slashActive.key}`);
        } else {
          const command = COMMANDS.find((c) => c.name === slashActive.key);
          if (command) setText(`/${command.name}${command.takesArg ? " " : ""}`);
        }
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        setSlashDismissedFor(text);
        return;
      }
      if (e.key === "Enter" && !e.shiftKey) {
        // The one menu rule: Enter takes the highlighted row. The highlight
        // opens on the current value, so an untouched picker's Enter is a
        // no-op set — never an accidental change.
        e.preventDefault();
        if (slashActive) acceptSlash(slashActive);
        else submit();
        return;
      }
    }
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
          {queued.map((q, i) => (
            <QueueCard
              key={q.id}
              chip={String(i + 1)}
              title={t("chat.queuedSteerTitle")}
              text={q.text}
              onRemove={() => unqueueMessage(q.id)}
              removeAria={t("chat.unqueueAria")}
            />
          ))}
        </div>
      )}
      {queuedRun && (
        <QueueCard
          chip={t("queue.position", { position: queuedPosition })}
          title={t("queue.queuedTitle")}
          text={queuedRun.task}
          onRemove={cancelQueuedRun}
          removeAria={t("queue.cancel")}
        />
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
      {/* The tip is this zone's lowest-priority tenant: it renders only while
          idle with a pristine composer — a queue card, an attachment or a paste
          hint already makes the footer tall, and the run band carries the tip
          while working (under the same eviction rule). */}
      {!(running || (boardRunHere && !bridgeActive)) &&
        queued.length === 0 &&
        !queuedRun &&
        attachments.length === 0 &&
        !pastedTexts.some((p) => text.includes(p.token)) && <TipLine />}
      {/* One card, two tenants: the bare input on top, a footer row below with
          the run target on the left and the morph button on the right — so the
          textarea never shares its width with a button column. */}
      <div className="relative rounded-xl border border-neutral-300 transition-colors focus-within:border-brand-500 dark:border-neutral-600">
        {slashOpen && slash && (
          <SlashMenu
            items={slash.items}
            index={slashIndex}
            onHover={(index) => setSlashState({ key: slashKey, index })}
            onPick={acceptSlash}
          />
        )}
        <TextArea
          bare
          ref={areaRef}
          className="w-full"
          rows={2}
          autoFocus
          aria-label={t("chat.inputAria")}
          aria-expanded={slashOpen}
          aria-controls={slashOpen ? "slash-menu" : undefined}
          aria-activedescendant={slashActive ? `slash-menu-item-${slashActive.key}` : undefined}
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
        <div className="flex items-center gap-1 px-1.5 pb-1.5">
          <RunTargetToggle />
          {pastedTexts.some((p) => text.includes(p.token)) && (
            <p
              className="min-w-0 flex-1 truncate text-right text-[11px] italic text-neutral-500 dark:text-neutral-400"
              title={t("chat.pasteHint")}
            >
              {t("chat.pasteHint")}
            </p>
          )}
          {stopVisible ? (
            <Button
              size="icon"
              variant="danger"
              className="ml-auto shrink-0"
              onClick={stop}
              title={t("chat.stopTitle")}
              aria-label={t("chat.stop")}
            >
              <StopIcon />
            </Button>
          ) : (
            <Button
              size="icon"
              className="ml-auto shrink-0"
              onClick={submit}
              disabled={!text.trim()}
              title={steering ? t("chat.queueTitle") : t("chat.sendTitle")}
              aria-label={steering ? t("chat.queue") : t("chat.send")}
            >
              <SendIcon />
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
