import { defineItem } from "./storage";

/**
 * Show model reasoning expanded by default. Off by default — the reasoning
 * stream is for the curious, and a collapsed "Thought for 3m 48s" line is the
 * calmer transcript. Clicking a reasoning block toggles this for all of them.
 */
export const showReasoning = defineItem<boolean>("showReasoning", false);

/** Where a background run's fresh tab starts when the task names no URL —
 *  overridable in Settings. */
export const defaultStartUrl = defineItem<string>("defaultStartUrl", "https://www.google.com");

/** The floating run-status widget's hide preference — respected across runs;
 *  re-enabled from Settings. The toolbar badge is the injection-free floor
 *  beneath it, so hiding this never leaves a run invisible — it only drops the
 *  floating pill. */
export const widgetHidden = defineItem<boolean>("widgetHidden", false);

/** One-shot migration: clear a stored "hide" so the pill's new default — show
 *  while a run is up — reaches users who turned it off in the fork era.
 *  Checked before `widgetHidden.remove()` fires, then set so it never runs
 *  again; the MV3 worker restarts constantly, so without this the user's
 *  setting would be wiped on every boot. */
export const widgetResetV1 = defineItem<boolean>("widgetResetV1", false);

/** Rotating tips under the run band and in the composer footer — on unless the
 *  user turns them off in Settings. Checked at pick time, so off applies to the
 *  very next boundary. */
export const tipsEnabled = defineItem<boolean>("tipsEnabled", true);
