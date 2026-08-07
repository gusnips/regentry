import { Button as BaseButton } from "@base-ui-components/react";
import type { ComponentProps } from "react";

type Variant = "primary" | "danger" | "ghost" | "ghost-danger";
type Size = "sm" | "md";

const VARIANTS: Record<Variant, string> = {
  primary: "bg-brand-600 text-white hover:bg-brand-700 disabled:opacity-40",
  danger: "bg-red-600 text-white hover:bg-red-700 disabled:opacity-40",
  ghost: "text-neutral-600 hover:bg-neutral-100 disabled:opacity-40",
  "ghost-danger": "text-red-600 hover:bg-red-50 disabled:opacity-40",
};

const SIZES: Record<Size, string> = {
  sm: "px-2 py-1 text-xs",
  md: "px-3 py-2 text-sm",
};

/** Class helper for places that render a button through another Base UI part
 *  (e.g. AlertDialog.Close) and can't use the Button component itself. */
export function buttonClasses(variant: Variant = "primary", size: Size = "md"): string {
  return `rounded-lg font-medium transition-colors cursor-pointer ${VARIANTS[variant]} ${SIZES[size]}`;
}

export function Button({
  variant = "primary",
  size = "md",
  className = "",
  ...props
}: ComponentProps<typeof BaseButton> & { variant?: Variant; size?: Size }) {
  return <BaseButton className={`${buttonClasses(variant, size)} ${className}`} {...props} />;
}
