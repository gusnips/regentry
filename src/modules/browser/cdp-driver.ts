import type { TabId } from "@/shared/types";
import { i18n } from "@/i18n";
import { refreshAgentIndicator } from "./indicator";

/**
 * CDP driver — manages chrome.debugger attach/detach and dispatches trusted input events.
 *
 * chrome.debugger provides trusted (isTrusted=true) events — the whole reason
 * we use CDP instead of synthetic JS events. Real clicks and key presses that
 * frameworks (React, Vue) and SPAs can't distinguish from human input.
 */

const attachedTabs = new Set<TabId>();
let activeTab: TabId | null = null;

chrome.tabs.onRemoved.addListener((tabId) => {
  attachedTabs.delete(tabId);
  if (activeTab === tabId) activeTab = null;
});

chrome.debugger.onDetach.addListener((source) => {
  if (source.tabId) {
    attachedTabs.delete(source.tabId);
    if (activeTab === source.tabId) activeTab = null;
  }
});

export class DebuggerConflictError extends Error {
  constructor(tabId: TabId) {
    super(
      `Cannot attach debugger to tab ${tabId}. DevTools may be open on this tab, ` +
        `or another extension is using chrome.debugger. Close DevTools and try again.`,
    );
    this.name = "DebuggerConflictError";
  }
}

export class RestrictedUrlError extends Error {
  constructor(tabId: TabId) {
    super(
      `Cannot use debugger on tab ${tabId}. Chrome blocks debugger on chrome:// pages, ` +
        `the Web Store, and other restricted URLs. Navigate to a regular page first.`,
    );
    this.name = "RestrictedUrlError";
  }
}

async function attach(tabId: TabId): Promise<void> {
  if (attachedTabs.has(tabId)) {
    activeTab = tabId;
    return;
  }
  try {
    await chrome.debugger.attach({ tabId }, "1.3");
    attachedTabs.add(tabId);
    activeTab = tabId;
    // Feed the run's network/console capture (inspect.ts) from the attach on —
    // by the time the model looks, the failing request is already in the log.
    await send("Network.enable");
    await send("Runtime.enable");
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.includes("Another debugger is already attached")) {
      throw new DebuggerConflictError(tabId);
    }
    if (msg.includes("'chrome://' URL") || msg.includes("Cannot attach")) {
      throw new RestrictedUrlError(tabId);
    }
    throw e;
  }
}

async function send(method: string, params?: Record<string, unknown>): Promise<unknown> {
  if (activeTab === null) throw new Error(i18n.t("errors.noTabAttached"));
  return chrome.debugger.sendCommand({ tabId: activeTab }, method, params);
}

export async function ensureAttached(tabId: TabId): Promise<void> {
  await attach(tabId);
}

/** Click at coordinates via trusted CDP mouse events. */
export async function clickAt(x: number, y: number): Promise<void> {
  await send("Input.dispatchMouseEvent", { type: "mouseMoved", x, y, button: "none", buttons: 0 });
  await send("Input.dispatchMouseEvent", {
    type: "mousePressed",
    x,
    y,
    button: "left",
    buttons: 1,
    clickCount: 1,
  });
  await send("Input.dispatchMouseEvent", {
    type: "mouseReleased",
    x,
    y,
    button: "left",
    buttons: 0,
    clickCount: 1,
  });
}

// CDP modifier bitmask: Alt=1, Ctrl=2, Meta/Cmd=4, Shift=8
let selectAllModifier: number | null = null;

async function getSelectAllModifier(): Promise<number> {
  if (selectAllModifier === null) {
    const info = await chrome.runtime.getPlatformInfo();
    selectAllModifier = info.os === "mac" ? 4 : 2;
  }
  return selectAllModifier;
}

/** Type text via CDP insertText (trusted input). Clears existing field first. */
export async function typeText(text: string): Promise<void> {
  const mod = await getSelectAllModifier();
  await send("Input.dispatchKeyEvent", {
    type: "keyDown",
    key: "a",
    code: "KeyA",
    windowsVirtualKeyCode: 65,
    modifiers: mod,
  });
  await send("Input.dispatchKeyEvent", {
    type: "keyUp",
    key: "a",
    code: "KeyA",
    windowsVirtualKeyCode: 65,
    modifiers: mod,
  });
  await send("Input.insertText", { text });
}

/** Append text without clearing (for contenteditable or partial input). */
export async function insertText(text: string): Promise<void> {
  await send("Input.insertText", { text });
}

/** Press a key (Enter, Tab, Escape, etc.) via CDP key events. */
const KEY_MAP: Record<string, { key: string; code: string; vkc: number; text?: string }> = {
  enter: { key: "Enter", code: "Enter", vkc: 13, text: "\r" },
  escape: { key: "Escape", code: "Escape", vkc: 27 },
  tab: { key: "Tab", code: "Tab", vkc: 9, text: "\t" },
  backspace: { key: "Backspace", code: "Backspace", vkc: 8 },
  delete: { key: "Delete", code: "Delete", vkc: 46 },
  arrowup: { key: "ArrowUp", code: "ArrowUp", vkc: 38 },
  arrowdown: { key: "ArrowDown", code: "ArrowDown", vkc: 40 },
  arrowleft: { key: "ArrowLeft", code: "ArrowLeft", vkc: 37 },
  arrowright: { key: "ArrowRight", code: "ArrowRight", vkc: 39 },
  space: { key: " ", code: "Space", vkc: 32, text: " " },
};

/** The supported key names. The model-facing press_key enum is built from this
 *  list, so the schema the model sees and what the driver accepts can't drift. */
export const SUPPORTED_KEYS = Object.keys(KEY_MAP);

export async function pressKey(key: string): Promise<void> {
  const k = key.toLowerCase();
  const spec = KEY_MAP[k];
  if (!spec)
    throw new Error(i18n.t("errors.unsupportedKey", { key, supported: SUPPORTED_KEYS.join(", ") }));
  const down: Record<string, unknown> = {
    type: "keyDown",
    key: spec.key,
    code: spec.code,
    windowsVirtualKeyCode: spec.vkc,
  };
  if (spec.text) down.text = spec.text;
  await send("Input.dispatchKeyEvent", down);
  await send("Input.dispatchKeyEvent", {
    type: "keyUp",
    key: spec.key,
    code: spec.code,
    windowsVirtualKeyCode: spec.vkc,
  });
}

/** Scroll the page by relative amounts. */
export async function scroll(deltaX: number, deltaY: number): Promise<void> {
  await send("Input.dispatchMouseEvent", {
    type: "mouseWheel",
    x: 0,
    y: 0,
    deltaX,
    deltaY,
    modifiers: 0,
    pointerType: "mouse",
  });
}

/**
 * Capture the visible viewport as a `data:` URL, ready to hand to a model.
 *
 * JPEG, not PNG: a screenshot goes into the next request body, and PNG runs
 * several times larger for no readability gain at q80 — on a slow uplink that
 * difference is seconds per step.
 */
export async function screenshot(): Promise<string> {
  const result = (await send("Page.captureScreenshot", {
    format: "jpeg",
    quality: 80,
  })) as { data: string };
  return `data:image/jpeg;base64,${result.data}`;
}

/** A runaway page script gets this long before CDP terminates the evaluation. */
const EVAL_TIMEOUT_MS = 30_000;

interface EvalResponse {
  result: { type: string; value?: unknown; description?: string };
  exceptionDetails?: { text: string; exception?: { description?: string } };
}

/**
 * Run JavaScript in the page's main world — the model's escape hatch when the
 * tree and trusted input can't do the job. CDP rather than executeScript:
 * page CSP does not apply to debugger evaluation (a string eval injected into
 * the MAIN world dies on any strict script-src page), awaitPromise and
 * replMode come free, and the debugger is already attached for trusted input.
 */
export async function evaluateRaw(expression: string): Promise<unknown> {
  const attempt = (expr: string, replMode: boolean) =>
    send("Runtime.evaluate", {
      expression: expr,
      returnByValue: true,
      awaitPromise: true,
      replMode,
      // What the DevTools console grants: clicks and popups the code triggers
      // behave as if the user had acted.
      userGesture: true,
      timeout: EVAL_TIMEOUT_MS,
    }) as Promise<EvalResponse>;

  let r = await attempt(expression, true);
  // Models write statements with a top-level `return`, which REPL mode
  // rejects — rerun wrapped as an async IIFE, the console's own fallback.
  if (r.exceptionDetails && /Illegal return statement/.test(r.exceptionDetails.text)) {
    r = await attempt(`(async () => {\n${expression}\n})()`, false);
  }
  if (r.exceptionDetails) {
    throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);
  }
  const { result } = r;
  if (result.value !== undefined) return result.value;
  if (result.type === "undefined") return null;
  // returnByValue drops what JSON can't carry (a DOM node, a function) — the
  // description ("div.cart-summary") tells the model to serialize it in-page.
  return result.description ?? null;
}

/** Navigate the tab to a URL via chrome.tabs (not CDP — works pre-attach). */
export async function navigateToUrl(tabId: TabId, url: string): Promise<void> {
  await chrome.tabs.update(tabId, { url });
  await waitForLoad(tabId);
  // The new document wiped the badge — put it back before the agent acts here.
  await refreshAgentIndicator(tabId);
}

export function waitForLoad(tabId: TabId, timeoutMs = 30_000): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      chrome.tabs.onUpdated.removeListener(listener);
      reject(
        new Error(
          `Page load timeout (${timeoutMs / 1000}s) — the page may be slow or unresponsive.`,
        ),
      );
    }, timeoutMs);

    const check = (tab: chrome.tabs.Tab) =>
      tab.status === "complete" && !!tab.url && tab.url !== "about:blank";

    const listener = (id: number, _info: chrome.tabs.OnUpdatedInfo, tab: chrome.tabs.Tab) => {
      if (id === tabId && check(tab)) {
        clearTimeout(timer);
        chrome.tabs.onUpdated.removeListener(listener);
        resolve();
      }
    };

    chrome.tabs.get(tabId, (tab) => {
      if (check(tab)) {
        clearTimeout(timer);
        resolve();
      } else {
        chrome.tabs.onUpdated.addListener(listener);
      }
    });
  });
}
