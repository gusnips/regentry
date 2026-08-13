import type { ComponentProps } from "react";

type Variant = "default" | "secondary" | "muted" | "destructive";

const VARIANTS: Record<Variant, string> = {
  default: "bg-brand-500 text-brand-950",
  secondary: "bg-neutral-100 text-neutral-900 dark:bg-neutral-800 dark:text-neutral-100",
  muted: "bg-neutral-100 dark:bg-neutral-800",
  /** An error is a notice, not an alarm: a whisper of red for shape, neutral
   *  text for the message, and the red accents left to the icon and actions. */
  destructive:
    "border border-red-200/70 bg-red-50/50 text-neutral-800 dark:border-red-900/60 dark:bg-red-950/30 dark:text-neutral-200",
};

/** Framed conversational content, adapted from shadcn/ui's Bubble
 *  (ui.shadcn.com/docs/components/base/bubble, base-nova): the frame carries
 *  variant + alignment, the content carries text flow. Trimmed to the variants
 *  and subcomponents TabRunner uses — no reactions, no polymorphic render. */
export function Bubble({
  variant = "secondary",
  align = "start",
  className = "",
  ...props
}: ComponentProps<"div"> & { variant?: Variant; align?: "start" | "end" }) {
  return (
    <div
      data-slot="bubble"
      data-variant={variant}
      data-align={align}
      className={`flex w-fit max-w-[85%] min-w-0 flex-col rounded-lg px-3 py-2 text-sm break-words whitespace-pre-wrap data-[align=end]:self-end ${VARIANTS[variant]} ${className}`}
      {...props}
    />
  );
}

export function BubbleContent({ className = "", ...props }: ComponentProps<"div">) {
  return <div data-slot="bubble-content" className={`min-w-0 ${className}`} {...props} />;
}
