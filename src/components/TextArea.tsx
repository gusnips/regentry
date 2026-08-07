import type { ComponentProps } from "react";

/**
 * Styled multiline input. Base UI has no textarea part (Field.Control renders
 * a single-line input), so the shared composer styling lives here instead.
 */
export function TextArea({ className = "", ...props }: ComponentProps<"textarea">) {
  return (
    <textarea
      className={`resize-none rounded-lg border border-neutral-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none disabled:opacity-50 ${className}`}
      {...props}
    />
  );
}
