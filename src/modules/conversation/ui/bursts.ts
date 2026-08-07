import type { Message } from "../types";

/**
 * With reasoning hidden, a transcript alternates heavy "Thought for 2s" chips
 * with quiet tool rows — one chip per action, all noise. A burst folds each
 * maximal thought+step run into a single quiet line ("Thinking, Clicking e25,
 * Typing 200 and 5 more · 2m 10s") that expands back to the rows. Runs without
 * both stay flat: a lone chip or a plain tool row is already quiet.
 */
export interface Burst {
  kind: "burst";
  id: string;
  /** The run in original order — steps and the thoughts between them. */
  items: Message[];
  steps: Message[];
  /** Epoch ms when the run began. A thought's timestamp marks its END, so a leading thought walks back its elapsed. */
  startedAt: number;
  /** Epoch ms when the run ended — absent while it is the tail of the transcript. */
  endedAt?: number;
  live: boolean;
}

export type RenderItem = { kind: "message"; msg: Message } | Burst;

const BURST_ROLES = new Set<Message["role"]>(["reasoning", "step"]);

export function groupBursts(messages: Message[]): RenderItem[] {
  const out: RenderItem[] = [];
  let run: Message[] = [];

  const flush = (endedAt?: number) => {
    const first = run[0];
    if (!first) return;
    const steps = run.filter((m) => m.role === "step");
    const thoughts = run.filter((m) => m.role === "reasoning");
    if (steps.length > 0 && thoughts.length > 0) {
      out.push({
        kind: "burst",
        id: first.id,
        items: run,
        steps,
        startedAt: first.timestamp - (first.role === "reasoning" ? (first.elapsed ?? 0) : 0),
        endedAt,
        live: steps.some((m) => m.live),
      });
    } else {
      out.push(...run.map((msg) => ({ kind: "message" as const, msg })));
    }
    run = [];
  };

  for (const m of messages) {
    if (BURST_ROLES.has(m.role)) run.push(m);
    else {
      flush(m.timestamp);
      out.push({ kind: "message", msg: m });
    }
  }
  flush();
  return out;
}
