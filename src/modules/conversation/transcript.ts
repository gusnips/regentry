import type { Event } from "@/shared/protocol";
import type { Message } from "./types";
import { appendMessageTo, replaceMessageTo } from "./conversations";
import { createLogger } from "@/lib/logger";

const log = createLogger("transcript");

function makeMsg(role: Message["role"], content: string, extra?: Partial<Message>): Message {
  return { id: crypto.randomUUID(), role, content, timestamp: Date.now(), ...extra };
}

/** Case/whitespace/trailing-punctuation-blind equality — enough to spot a
 * summary repeating streamed prose verbatim. Deliberately conservative: a
 * dedup that swallows a genuinely different summary re-creates the silence. */
function sameText(a: string, b: string): boolean {
  const norm = (s: string) =>
    s
      .trim()
      .replace(/[.!?…,:;]+$/, "")
      .replace(/\s+/g, " ")
      .toLowerCase();
  return norm(a) === norm(b);
}

/**
 * The done summary is the run's closing word — the user must never be left
 * without one. Dropping it whenever ANY prose streamed (the old gate) made
 * runs end silent the moment the model spent a one-liner mid-way; only a
 * verbatim repeat of prose already shown adds nothing.
 */
export function closingSummary(
  sawProse: boolean,
  lastProse: string | undefined,
  summary: string | undefined,
): string | null {
  const text = summary?.trim();
  if (!text) return null;
  if (sawProse && lastProse !== undefined && sameText(lastProse, text)) return null;
  return text;
}

/**
 * Background-safe transcript writer — the persistence half of the panel store's
 * `handleEvent`, usable anywhere the run's events land (the panel delegates its
 * storage here; the bridge drives it directly). One writer per run, bound to its
 * conversation id: it mirrors the event stream, closes reasoning/text segments
 * at the same points the display does, and appends/replaces transcript messages
 * through the serialized conversation storage. Keep this reducer in lockstep
 * with the store's display path — they are two views of one event stream.
 */
export class TranscriptWriter {
  private streamingText = "";
  private reasoningText = "";
  private reasoningStartedAt: number | null = null;
  private sawAssistantText = false;
  /** The newest assistant message persisted — the done summary's dedup target. */
  private lastAssistant: string | null = null;
  /** The plan card, remembered so updates rewrite it instead of stacking copies. */
  private planMsg: Message | null = null;

  constructor(private readonly conversationId: string) {}

  /** Append/replace fire-and-forget — the storage layer serializes writes itself. */
  private append(msg: Message): void {
    void appendMessageTo(this.conversationId, msg).catch((e) => {
      log.debug("transcript append failed:", e instanceof Error ? e.message : String(e));
    });
  }

  private replace(msg: Message): void {
    void replaceMessageTo(this.conversationId, msg).catch((e) => {
      log.debug("transcript replace failed:", e instanceof Error ? e.message : String(e));
    });
  }

  /** Reasoning and text close at the same points the display closes them. */
  private flushReasoning(): void {
    const text = this.reasoningText.trim();
    if (text) {
      this.append(
        makeMsg(
          "reasoning",
          text,
          this.reasoningStartedAt ? { elapsed: Date.now() - this.reasoningStartedAt } : undefined,
        ),
      );
    }
    this.reasoningText = "";
    this.reasoningStartedAt = null;
  }

  private flushStreaming(): void {
    const text = this.streamingText.trim();
    if (text) {
      this.sawAssistantText = true;
      this.lastAssistant = text;
      this.append(makeMsg("assistant", text));
    }
    this.streamingText = "";
  }

  /** Process one run event, persisting whatever transcript entry it implies. Synchronous: state mutations never await. */
  apply(event: Event): void {
    switch (event.type) {
      case "token":
        this.flushReasoning();
        this.streamingText += event.text;
        break;

      case "reasoning":
        this.flushStreaming();
        this.reasoningText += event.text;
        // The first delta of a segment starts its clock.
        this.reasoningStartedAt ??= Date.now();
        break;

      case "step_start":
        // Live rows are display-only — nothing to persist; just close the segment.
        this.flushReasoning();
        break;

      case "step": {
        this.flushReasoning();
        this.append(
          makeMsg("step", event.summary, {
            tool: event.tool,
            ok: event.ok,
            args: event.args,
            detail: event.detail,
            images: event.images,
            live: false,
          }),
        );
        break;
      }

      case "plan": {
        this.flushReasoning();
        this.flushStreaming();
        const plan = { steps: event.steps, current: event.current };
        if (this.planMsg) {
          // Rewritten in place — a new copy on every completed step would bury the card.
          this.planMsg = { ...this.planMsg, ...plan };
          this.replace(this.planMsg);
        } else {
          this.planMsg = makeMsg("plan", "", plan);
          this.append(this.planMsg);
        }
        break;
      }

      case "injected":
        // The loop consumed a queued message — it becomes a real transcript entry.
        this.append(makeMsg("user", event.text));
        break;

      case "usage":
      case "driving":
        break;

      case "error":
        this.flushReasoning();
        this.flushStreaming();
        this.append(makeMsg("error", event.message, { kind: event.kind }));
        break;

      case "done": {
        this.flushReasoning();
        this.flushStreaming();
        const closing = closingSummary(
          this.sawAssistantText,
          this.lastAssistant ?? undefined,
          event.summary,
        );
        if (closing) {
          this.lastAssistant = closing;
          this.append(makeMsg("assistant", closing));
        }
        break;
      }
    }
  }
}
