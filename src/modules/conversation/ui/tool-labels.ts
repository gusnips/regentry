import { truncateTo } from "@/lib/format";

/**
 * Tool → i18n key for the human label ("Reading page"). Shared by the live
 * step rows, the persisted trace, and the RunStatus verb so one tool never
 * reads three different ways.
 */
const TOOL_VERB_KEYS = {
  navigate: "run.tool.navigate",
  list_tabs: "run.tool.list_tabs",
  switch_tab: "run.tool.switch_tab",
  snapshot: "run.tool.snapshot",
  click: "run.tool.click",
  type: "run.tool.type",
  press_key: "run.tool.press_key",
  scroll_down: "run.tool.scroll",
  scroll_up: "run.tool.scroll",
  screenshot: "run.tool.screenshot",
  remember: "run.tool.remember",
  ask_user: "run.tool.ask_user",
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

function text(value: unknown, max = 48): string | undefined {
  if (typeof value !== "string" || !value.trim()) return undefined;
  return truncateTo(value, max);
}

/** Host only — the full URL is in the drill-down, and it never fits on one line. */
function host(value: unknown): string | undefined {
  const raw = text(value, 200);
  if (!raw) return undefined;
  try {
    return new URL(raw).host.replace(/^www\./, "");
  } catch {
    return text(raw);
  }
}

/**
 * The distinguishing argument of a tool call, short enough for one row:
 * "Navigating · news.ycombinator.com" beats three identical "Navigating" lines.
 */
export function toolHint(
  tool: string | undefined,
  args: Record<string, unknown> | undefined,
): string | undefined {
  if (!tool || !args) return undefined;
  switch (tool) {
    case "navigate":
      return host(args.url);
    case "switch_tab":
      // The id is all the call carries; the tab's title arrives in the result,
      // which the summary already shows on a success. On a failure this is the
      // only trace of what it reached for.
      return typeof args.tab_id === "number" ? `#${args.tab_id}` : undefined;
    case "click":
      return text(args.ref);
    case "type":
      return text(args.text);
    case "press_key":
      return text(args.key);
    case "scroll_down":
    case "scroll_up":
      return typeof args.amount === "number" ? `${args.amount}px` : undefined;
    default:
      return undefined;
  }
}
