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

/** Where a submitted task drives — the user's current page ("thisPage", the
 *  default, with the panel open) or the same tab with the panel closed after
 *  plan approval ("background"). Both drive the tab you're on; the only
 *  difference is whether you watch or walk away. */
export type RunTarget = "background" | "thisPage";

/** The toggle's last choice, kept across runs and panel opens. A working mode
 *  is a habit, not a per-run decision: someone dispatching background tasks all
 *  afternoon should not re-flip it after every run (and after every error, which
 *  is when re-flipping is most annoying). Lives here rather than in the panel
 *  store so the choice survives the panel closing itself. */
export const runTargetPref = defineItem<RunTarget>("runTarget", "thisPage");
