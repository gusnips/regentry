import type { ModelInfo } from "../types";

/**
 * How many model rows one expanded provider draws at most. OpenRouter lists
 * 300+ and Ollama lists whatever is installed — past a screenful the list stops
 * being browsable and the filter is the only way through it anyway.
 *
 * ponytail: a flat cap, not virtualization. The ceiling is that the 51st model
 * is reachable by filtering, never by scrolling; the upgrade path is a windowed
 * list if a provider ever ships thousands.
 */
export const MODEL_ROW_CAP = 50;

/** Above this, the group grows a filter field — below it, scanning is faster. */
export const FILTER_THRESHOLD = 12;

export interface NarrowedModels {
  shown: ModelInfo[];
  /** Matches the cap hid — surfaced as a line, never dropped silently. */
  hidden: number;
  /** Matches before the cap, so "nothing matched" is tellable from "capped". */
  matched: number;
}

/**
 * The rows an expanded provider group draws: substring-filtered on both the
 * display name and the wire id (a user who knows "sonnet-4-5" and a user who
 * knows "Claude Sonnet" both find it), then capped.
 */
export function narrowModels(models: ModelInfo[], query: string, cap = MODEL_ROW_CAP): NarrowedModels {
  const q = query.trim().toLowerCase();
  const matched = q
    ? models.filter(
        (m) => m.id.toLowerCase().includes(q) || (m.name ?? "").toLowerCase().includes(q),
      )
    : models;
  return {
    shown: matched.slice(0, cap),
    hidden: Math.max(0, matched.length - cap),
    matched: matched.length,
  };
}
