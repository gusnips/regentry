import { Field } from "@base-ui-components/react";
import type { ComponentProps, ReactNode } from "react";

/** Matches Select's scale: sm = panel-header density, md = forms. */
const SIZES = {
  md: "px-3 py-2",
  sm: "px-2 py-1 text-xs",
} as const;

/**
 * Labeled text input — Base UI Field wires label ↔ control (htmlFor/id) and
 * description ↔ control (aria-describedby). Use for every text input.
 * `className` is appended for layout; pick density with `size`, not by
 * re-declaring padding (Tailwind wouldn't resolve the conflict predictably).
 */
export function TextField({
  label,
  hint,
  size = "md",
  className = "",
  ...props
}: /* the DOM `size` attribute (a character count) is not something we use */
Omit<ComponentProps<typeof Field.Control>, "size"> & {
  label?: string;
  hint?: ReactNode;
  size?: keyof typeof SIZES;
}) {
  return (
    <Field.Root className={`flex flex-col gap-1 text-sm ${className}`}>
      {label && (
        <Field.Label className="font-medium text-neutral-700 dark:text-neutral-300">
          {label}
        </Field.Label>
      )}
      <Field.Control
        className={`rounded-lg border border-neutral-300 placeholder:text-neutral-400 focus:border-brand-500 focus:outline-none dark:border-neutral-600 dark:placeholder:text-neutral-500 ${SIZES[size]}`}
        {...props}
      />
      {hint && (
        <Field.Description className="text-xs text-neutral-400 dark:text-neutral-500">
          {hint}
        </Field.Description>
      )}
    </Field.Root>
  );
}
