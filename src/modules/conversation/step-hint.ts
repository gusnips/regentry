import { truncateTo } from "@/lib/format";

/**
 * The distinguishing argument of a tool call, short enough for one line —
 * "navigate · reddit.com" beats a dozen identical "navigate" rows. Background-safe
 * sibling of the panel's `toolHint` (conversation/ui/tool-labels.ts): the runtime
 * boundary keeps ui/ code out of the writer and the agent tools, so the two hint
 * functions live on their own sides of it.
 */
export function stepHint(
  tool: string | undefined,
  args: Record<string, unknown> | undefined,
): string | undefined {
  if (!tool || !args) return undefined;
  const text = (value: unknown): string | undefined =>
    typeof value === "string" && value.trim() ? truncateTo(value, 48) : undefined;
  switch (tool) {
    case "navigate": {
      const url = text(args.url);
      if (!url) return undefined;
      try {
        return new URL(url).host.replace(/^www\./, "");
      } catch {
        return url;
      }
    }
    case "click":
      return text(args.ref);
    case "type":
      return text(args.text);
    case "switch_tab":
      return typeof args.tab_id === "number" ? `#${args.tab_id}` : undefined;
    default:
      return undefined;
  }
}
