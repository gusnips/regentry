/**
 * Tool → i18n key for the human label ("Reading page"). Shared by the live
 * step rows, the persisted trace, and the RunStatus verb so one tool never
 * reads three different ways.
 */
const TOOL_VERB_KEYS = {
  navigate: "run.tool.navigate",
  snapshot: "run.tool.snapshot",
  click: "run.tool.click",
  type: "run.tool.type",
  press_key: "run.tool.press_key",
  scroll_down: "run.tool.scroll",
  scroll_up: "run.tool.scroll",
  screenshot: "run.tool.screenshot",
  done: "run.tool.done",
  retry: "run.tool.retry",
  warn: "run.tool.warn",
  interrupted: "run.tool.interrupted",
} as const;

/** Literal union, not `string` — the i18n catalog is typed and rejects widened keys. */
export type ToolVerbKey = (typeof TOOL_VERB_KEYS)[keyof typeof TOOL_VERB_KEYS];

export function toolVerbKey(tool: string | undefined): ToolVerbKey | undefined {
  if (!tool) return undefined;
  return TOOL_VERB_KEYS[tool as keyof typeof TOOL_VERB_KEYS];
}
