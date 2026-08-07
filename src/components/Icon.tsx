import type { ReactNode } from "react";

/**
 * The shared svg shell for the panel's stroke icons — each icon is just its
 * paths. Stroke inherits currentColor, so icons follow the text color.
 */
export function Icon({ size = 14, children }: { size?: number; children: ReactNode }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      {children}
    </svg>
  );
}
