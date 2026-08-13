/**
 * Where the caret sits in a textarea, in VISUAL lines — soft wraps count.
 * History recall's edge rule needs them: a long paragraph wraps into many rows
 * in the narrow composer, and ↑ on a wrapped row must move the caret up one
 * row, not recall a sent message. Logical lines (\n) can't see wraps, so we
 * measure instead: a mirror div with the same typography and content width
 * holds the text up to the caret plus a marker, and the marker's offset names
 * the line. One attach, a few layout reads, straight back out.
 */
const COPY_PROPS = [
  "fontFamily",
  "fontSize",
  "fontWeight",
  "fontStyle",
  "letterSpacing",
  "lineHeight",
  "textTransform",
  "textIndent",
  "tabSize",
  "overflowWrap",
] as const;

export function caretVisualLine(el: HTMLTextAreaElement): { line: number; lines: number } {
  const cs = getComputedStyle(el);
  const mirror = document.createElement("div");
  const style = mirror.style;
  style.position = "absolute";
  style.visibility = "hidden";
  style.whiteSpace = "pre-wrap";
  style.boxSizing = "content-box";
  // Content width, not element width: clientWidth includes the padding.
  style.width = `${el.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight)}px`;
  for (const p of COPY_PROPS) style[p] = cs[p];
  document.body.appendChild(mirror);
  try {
    // The mirror carries no padding, so its offsets and height measure pure
    // content lines. The resolved line-height (the computed value can be
    // "normal") is the height difference between one line and two.
    mirror.textContent = "x";
    const one = mirror.clientHeight;
    mirror.textContent = "x\nx";
    const lineH = mirror.clientHeight - one;

    // The zero-width marker keeps an empty wrapped/trailing line alive.
    const caret = el.selectionStart;
    mirror.textContent = el.value.slice(0, caret);
    const marker = document.createElement("span");
    marker.textContent = "\u200B";
    mirror.appendChild(marker);
    const line = Math.round(marker.offsetTop / lineH);

    mirror.textContent = `${el.value}\u200B`;
    const lines = Math.round(mirror.clientHeight / lineH);
    return { line: Math.min(line, lines - 1), lines };
  } finally {
    mirror.remove();
  }
}
