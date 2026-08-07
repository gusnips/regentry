import { defineItem } from "./storage";

/**
 * Show model reasoning expanded by default. Off by default — the reasoning
 * stream is for the curious, and a collapsed "Thought for 3m 48s" line is the
 * calmer transcript. Clicking a reasoning block toggles this for all of them.
 */
export const showReasoning = defineItem<boolean>("showReasoning", false);
