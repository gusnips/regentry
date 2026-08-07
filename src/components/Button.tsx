import { Button as BaseButton } from "@base-ui-components/react";
import type { ComponentProps } from "react";

type Variant = "primary" | "danger" | "ghost" | "ghost-danger" | "outline";
type Size = "sm" | "md";

const VARIANTS: Record<Variant, string> = {
  primary: "bg-brand-600 text-white hover:bg-brand-700 disabled:opacity-40",
  danger: "bg-red-600 text-white hover:bg-red-700 disabled:opacity-40",
  ghost:
    "text-neutral-600 hover:bg-neutral-100 dark:text-neutral-300 dark:hover:bg-neutral-800 disabled:opacity-40",
  "ghost-danger":
    "text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-950 disabled:opacity-40",
  outline:
    "border border-neutral-300 text-neutral-700 hover:bg-neutral-100 dark:border-neutral-600 dark:text-neutral-200 dark:hover:bg-neutral-800 disabled:opacity-40",
};

const SIZES: Record<Size, string> = {
  sm: "px-2 py-1 text-xs",
  md: "px-3 py-2 text-sm",
};

/** Class helper for places that render a button through another Base UI part
 *  (e.g. AlertDialog.Close) and can't use the Button component itself. */
export function buttonClasses(variant: Variant = "primary", size: Size = "md"): string {
  return `rounded-lg font-medium transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-1 ${VARIANTS[variant]} ${SIZES[size]}`;
}

export function Button({
  variant = "primary",
  size = "md",
  className = "",
  ...props
}: ComponentProps<typeof BaseButton> & { variant?: Variant; size?: Size }) {
  return <BaseButton className={`${buttonClasses(variant, size)} ${className}`} {...props} />;
}
