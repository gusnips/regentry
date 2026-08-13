import { describe, it, expect, vi, afterEach } from "vitest";
import { caretVisualLine } from "../ui/caret-line";

/**
 * jsdom has no layout, so the mirror's geometry is faked: LINE_H per line of
 * textContent, the marker span sitting at its line's top. What is under test
 * is the arithmetic contract — the composer HAS vertical padding (py-2), the
 * mirror does NOT, and the measurements must not subtract what was never
 * added. (The shipped subtraction made a one-line draft report 0 lines, and
 * ↑ recall died with it.)
 */
const LINE_H = 20;

function lineCount(text: string): number {
  return text.split("\n").length;
}

function fakeTextarea(value: string, caret: number): HTMLTextAreaElement {
  // Layout stub — only the three reads caretVisualLine makes.
  return { value, selectionStart: caret, clientWidth: 320 } as HTMLTextAreaElement;
}

function stubLayout(computedLineHeight = `${LINE_H}px`): void {
  let mirror = { textContent: "" };
  vi.spyOn(document, "createElement").mockImplementation((tag: string) => {
    if (tag === "div") {
      const div = {
        style: {} as Record<string, string>,
        textContent: "",
        appendChild: () => {},
        remove: () => {},
        get clientHeight() {
          return LINE_H * lineCount(this.textContent);
        },
      };
      mirror = div;
      return div as unknown as HTMLElement;
    }
    // The caret marker: its top is the top of the mirror's last line.
    const span = {
      textContent: "",
      get offsetTop() {
        return (lineCount(mirror.textContent) - 1) * LINE_H;
      },
    };
    return span as unknown as HTMLElement;
  });
  vi.spyOn(document.body, "appendChild").mockImplementation((node) => node);
  vi.spyOn(window, "getComputedStyle").mockReturnValue({
    paddingLeft: "12px",
    paddingRight: "12px",
    paddingTop: "8px",
    paddingBottom: "8px",
    lineHeight: computedLineHeight,
  } as unknown as CSSStyleDeclaration);
}

afterEach(() => vi.restoreAllMocks());

describe("caretVisualLine", () => {
  it("counts a one-line draft as one line — the composer's padding is not the mirror's", () => {
    stubLayout();
    expect(caretVisualLine(fakeTextarea("one", 3))).toEqual({ line: 0, lines: 1 });
  });

  it("places the caret on the second line of two", () => {
    stubLayout();
    expect(caretVisualLine(fakeTextarea("a\nbb", 4))).toEqual({ line: 1, lines: 2 });
  });

  it("keeps a trailing newline's empty line alive via the marker", () => {
    stubLayout();
    expect(caretVisualLine(fakeTextarea("a\n", 2))).toEqual({ line: 1, lines: 2 });
  });

  it("measures the line-height when the computed style says 'normal'", () => {
    stubLayout("normal");
    expect(caretVisualLine(fakeTextarea("a\nbb", 4))).toEqual({ line: 1, lines: 2 });
  });
});
