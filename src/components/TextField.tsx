import { Field } from "@base-ui-components/react";
import type { ComponentProps } from "react";

/**
 * Labeled text input — Base UI Field wires label ↔ control (htmlFor/id) and
 * gives us validation state hooks for free. Use for every text input.
 */
export function TextField({
  label,
  ...props
}: ComponentProps<typeof Field.Control> & { label?: string }) {
  return (
    <Field.Root className="flex flex-col gap-1 text-sm">
      {label && <Field.Label className="font-medium text-neutral-700">{label}</Field.Label>}
      <Field.Control
        className="rounded-lg border border-neutral-300 px-3 py-2 focus:border-brand-500 focus:outline-none"
        {...props}
      />
    </Field.Root>
  );
}
