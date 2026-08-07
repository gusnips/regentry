import type { BrowserDriver } from "@/modules/browser";
import type { ToolCall } from "@/modules/providers/types";

export interface ToolResult {
  ok: boolean;
  data?: unknown;
  error?: string;
}

/** Execute a single tool call against the browser driver. */
export async function executeTool(call: ToolCall, driver: BrowserDriver): Promise<ToolResult> {
  try {
    switch (call.name) {
      case "navigate":
        await driver.navigate(call.args.url as string);
        return { ok: true, data: { url: call.args.url } };

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
        const data = await driver.screenshot();
        // ponytail: don't persist screenshots — base64 in storage.local blows the quota.
        // Returned for model context only.
        return { ok: true, data: { format: "png", dataLength: data.length } };
      }

      case "done":
        return { ok: true, data: { summary: call.args.summary } };

      default:
        return { ok: false, error: `Unknown tool: ${call.name}` };
    }
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return { ok: false, error: message };
  }
}
