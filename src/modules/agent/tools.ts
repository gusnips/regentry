import type { BrowserDriver } from "@/modules/browser";
import type { ToolCall } from "@/modules/providers/types";
import { remember } from "@/modules/memory";
import { i18n } from "@/i18n";

/** Longer than this and the plan card stops being scannable in a side panel. */
const MAX_PLAN_STEPS = 20;

export interface ToolResult {
  ok: boolean;
  data?: unknown;
  error?: string;
  /** Images the tool produced, as `data:` URLs — fed to the model as image blocks. */
  images?: string[];
}

/** Execute a single tool call against the browser driver. */
export async function executeTool(call: ToolCall, driver: BrowserDriver): Promise<ToolResult> {
  try {
    switch (call.name) {
      case "navigate":
        await driver.navigate(call.args.url as string);
        return { ok: true, data: { url: call.args.url } };

      case "list_tabs": {
        const tabs = await driver.listTabs();
        return { ok: true, data: { tabs } };
      }

      case "switch_tab": {
        const tab = await driver.switchTab(call.args.tab_id as number);
        return { ok: true, data: tab };
      }

      case "snapshot": {
        const result = await driver.snapshot();
        return { ok: true, data: result };
      }

      case "click": {
        const { x, y } = await driver.click(call.args.ref as string);
        return { ok: true, data: { x, y } };
      }

      case "type":
        await driver.type(call.args.text as string);
        return { ok: true };

      case "press_key":
        await driver.key(call.args.key as string);
        return { ok: true };

      case "scroll_down":
        await driver.scrollDown(call.args.amount as number | undefined);
        return { ok: true };

      case "scroll_up":
        await driver.scrollUp(call.args.amount as number | undefined);
        return { ok: true };

      case "screenshot": {
        const image = await driver.screenshot();
        // The text half tells a text-only model what happened; the image half is
        // what a vision model actually reads. Both are needed — a provider that
        // silently drops images still gets a coherent transcript.
        return { ok: true, data: { captured: true }, images: [image] };
      }

      case "plan": {
        // ponytail: a flat list plus a cursor, not per-step statuses — weaker
        // models get nested enums wrong far more often than they get an index
        // wrong. The ceiling is that no step can be marked skipped or failed.
        const steps = (Array.isArray(call.args.steps) ? call.args.steps : [])
          .filter((s): s is string => typeof s === "string" && s.trim() !== "")
          .slice(0, MAX_PLAN_STEPS);
        if (steps.length === 0) return { ok: false, error: i18n.t("errors.planEmpty") };
        // Models routinely send a 1-based or already-past-the-end index; clamping
        // beats rejecting, since the plan is a display aid and never control flow.
        const raw = Number(call.args.current);
        const current = Number.isFinite(raw)
          ? Math.min(Math.max(0, Math.trunc(raw)), steps.length)
          : 0;
        return { ok: true, data: { steps, current } };
      }

      case "remember": {
        // Reachable only when memory is on — buildToolDefs withholds the tool
        // otherwise, so there is no second enabled check to drift out of sync.
        const stored = await remember(String(call.args.fact ?? ""));
        if (!stored) return { ok: false, error: i18n.t("errors.memoryEmpty") };
        return { ok: true, data: { fact: stored } };
      }

      case "done":
        return { ok: true, data: { summary: call.args.summary } };

      default:
        return { ok: false, error: i18n.t("errors.unknownTool", { name: call.name }) };
    }
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return { ok: false, error: message };
  }
}
