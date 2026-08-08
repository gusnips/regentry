import type { BrowserDriver } from "@/modules/browser";
import type { ToolCall } from "@/modules/providers/types";
import { remember } from "@/modules/memory";
import { i18n } from "@/i18n";
import { truncate } from "@/lib/logger";

/** Longer than this and the plan card stops being scannable in a side panel. */
const MAX_PLAN_STEPS = 20;
/** Result payloads are a drill-down, never a whole page inlined into the row. */
const MAX_DETAIL = 2000;

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

      case "ask_user":
        // No driver interaction — the loop ends the run on this call and the
        // panel renders the question; the answer arrives as the next message.
        return { ok: true, data: { question: call.args.question, choices: call.args.choices } };

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

/** Result payload for the panel's expandable row — bounded, never a whole page. */
export function formatDetail(tool: string, result: ToolResult): string | undefined {
  if (!result.ok) return result.error;
  if (tool === "snapshot") {
    const snapshot = result.data as { pageContent?: string } | undefined;
    return snapshot?.pageContent ? truncate(snapshot.pageContent, MAX_DETAIL) : undefined;
  }
  if (result.data === undefined) return undefined;
  const json = JSON.stringify(result.data, null, 2);
  return json && json !== "{}" ? truncate(json, MAX_DETAIL) : undefined;
}

export function formatSuccessSummary(tool: string, data: unknown): string {
  if (tool === "snapshot" && data && typeof data === "object") {
    const snap = data as { pageContent?: string };
    const lines = snap.pageContent?.split("\n").length ?? 0;
    return i18n.t("errors.capturedElements", { count: lines });
  }
  if (tool === "click" && data && typeof data === "object") {
    const pos = data as { x: number; y: number };
    return i18n.t("errors.clickedAt", { x: pos.x, y: pos.y });
  }
  if (tool === "press_key") {
    return i18n.t("errors.keyPressed");
  }
  if (tool === "navigate") {
    return i18n.t("errors.navigated");
  }
  if (tool === "switch_tab" && data && typeof data === "object") {
    return i18n.t("errors.switchedTo", { title: (data as { title?: string }).title ?? "" });
  }
  if (tool === "list_tabs" && data && typeof data === "object") {
    const tabs = (data as { tabs?: unknown[] }).tabs;
    return i18n.t("errors.tabsListed", { count: Array.isArray(tabs) ? tabs.length : 0 });
  }
  if (tool === "screenshot") {
    return i18n.t("errors.screenshotCaptured");
  }
  if (tool === "remember" && data && typeof data === "object") {
    // The fact itself is the summary — "Saved to memory" tells the user nothing
    // about what Regentry now knows, which is the only interesting part.
    return (data as { fact: string }).fact;
  }
  if (tool === "ask_user" && data && typeof data === "object") {
    // The question is the summary — the card renders it as the headline.
    return (data as { question?: string }).question ?? "";
  }
  return i18n.t("errors.toolCompleted", { tool });
}
