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
const ALT = 1;
const CTRL = 2;
const META = 4;
const SHIFT = 8;

let platformModifier: number | null = null;

/** Cmd on macOS, Ctrl everywhere else — what "Mod" and select-all both mean. */
async function getPlatformModifier(): Promise<number> {
  if (platformModifier === null) {
    const info = await chrome.runtime.getPlatformInfo();
    platformModifier = info.os === "mac" ? META : CTRL;
  }
  return platformModifier;
}

/** Test seam: the OS lookup is deliberately cached — this resets it. */
export function resetPlatformModifierForTest(): void {
  platformModifier = null;
}

/** Type text via CDP insertText (trusted input). Clears existing field first. */
export async function typeText(text: string): Promise<void> {
  const mod = await getPlatformModifier();
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

/** A key name resolved to its CDP event fields. */
interface KeySpec {
  key: string;
  code: string;
  vkc: number;
  text?: string;
}

/** Press a key (Enter, Tab, Escape, etc.) via CDP key events. */
const KEY_MAP: Record<string, KeySpec> = {
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

/** The named keys. The model-facing press_key description is built from this
 *  list, so what the model is told and what the driver accepts can't drift. */
export const SUPPORTED_KEYS = Object.keys(KEY_MAP);

/** What the model may name as a modifier. "Mod" spares it the platform guess. */
export const SUPPORTED_MODIFIERS = ["Mod", "Control", "Alt", "Shift", "Meta"];

const MODIFIER_BITS: Record<string, number> = {
  alt: ALT,
  option: ALT,
  control: CTRL,
  ctrl: CTRL,
  meta: META,
  cmd: META,
  command: META,
  shift: SHIFT,
};

/**
 * A key name resolved to its CDP event fields: one of KEY_MAP's names, or any
 * single character — the character case is what makes chords like Mod+a work
 * without listing all 36 alphanumerics in the schema.
 */
export function resolveKey(key: string): KeySpec {
  const named = KEY_MAP[key.toLowerCase()];
  if (named) return named;
  const chars = [...key];
  const ch = chars[0];
  if (chars.length === 1 && ch) {
    const upper = ch.toUpperCase();
    // A code only exists for keys that have a physical one; leaving it empty
    // for punctuation is better than inventing a wrong `Key;`.
    const code = /[a-z]/i.test(ch) ? `Key${upper}` : /[0-9]/.test(ch) ? `Digit${ch}` : "";
    return { key: ch, code, vkc: upper.charCodeAt(0), text: ch };
  }
  throw new Error(i18n.t("errors.unsupportedKey", { key, supported: SUPPORTED_KEYS.join(", ") }));
}

/** The bitmask for a list of model-supplied modifier names. */
export async function resolveModifiers(modifiers: string[]): Promise<number> {
  let bits = 0;
  for (const name of modifiers) {
    const key = name.trim().toLowerCase();
    const bit = key === "mod" ? await getPlatformModifier() : MODIFIER_BITS[key];
    if (bit === undefined) {
      throw new Error(
        i18n.t("errors.unsupportedModifier", {
          modifier: name,
          supported: SUPPORTED_MODIFIERS.join(", "),
        }),
      );
    }
    bits |= bit;
  }
  return bits;
}

export async function pressKey(key: string, modifiers: string[] = []): Promise<void> {
  const spec = resolveKey(key);
  const bits = await resolveModifiers(modifiers);
  const shifted = (bits & SHIFT) !== 0;
  // A chord with Ctrl/Alt/Cmd is a shortcut, not typing: sending `text` with
  // one held makes Chrome insert the character instead of firing the
  // accelerator, so Mod+a would type "a" over the selection it meant to make.
  // Shift alone IS typing — it just uppercases. The modifier keys themselves
  // are never dispatched as their own events; the bitmask is what sets
  // event.metaKey/ctrlKey, which is what pages actually read (typeText's
  // select-all has run this way since day one).
  const accelerated = (bits & ~SHIFT) !== 0;
  const text = accelerated ? undefined : shifted && spec.text ? spec.text.toUpperCase() : spec.text;
  const event = {
    key: shifted && spec.key.length === 1 ? spec.key.toUpperCase() : spec.key,
    code: spec.code,
    windowsVirtualKeyCode: spec.vkc,
    modifiers: bits,
  };
  await send("Input.dispatchKeyEvent", {
    type: "keyDown",
    ...event,
    ...(text ? { text } : {}),
  });
  await send("Input.dispatchKeyEvent", { type: "keyUp", ...event });
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

/** Back one entry in the tab's own history — the way out of a dead end. */
export async function goBack(tabId: TabId): Promise<void> {
  try {
    await chrome.tabs.goBack(tabId);
  } catch (e) {
    // Chrome's own message for an empty history reads as a forward-navigation
    // error ("Cannot find a next page in history"), which sends the model
    // looking for the wrong problem.
    throw new Error(i18n.t("errors.noHistoryBack"), { cause: e });
  }
  await waitForLoad(tabId);
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
