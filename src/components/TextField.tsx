import { Field } from "@base-ui-components/react";
import type { ComponentProps, ReactNode } from "react";

/**
 * Labeled text input — Base UI Field wires label ↔ control (htmlFor/id) and
 * description ↔ control (aria-describedby). Use for every text input.
 */
export function TextField({
  label,
  hint,
  ...props
}: ComponentProps<typeof Field.Control> & { label?: string; hint?: ReactNode }) {
  return (
    <Field.Root className="flex flex-col gap-1 text-sm">
      {label && (
        <Field.Label className="font-medium text-neutral-700 dark:text-neutral-300">
          {label}
        </Field.Label>
      )}
      <Field.Control
        className="rounded-lg border border-neutral-300 px-3 py-2 placeholder:text-neutral-400 focus:border-brand-500 focus:outline-none dark:border-neutral-600 dark:placeholder:text-neutral-500"
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
