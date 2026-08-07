import { useState } from "react";
import type { ComponentProps, ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Button as BaseButton, Field } from "@base-ui-components/react";

function EyeIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

function EyeOffIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" />
      <line x1="1" y1="1" x2="23" y2="23" />
    </svg>
  );
}

/**
 * Secret input with a show/hide eye toggle — use for API keys and tokens.
 * Same Field wiring as TextField (label, description).
 */
export function PasswordField({
  label,
  hint,
  ...props
}: ComponentProps<typeof Field.Control> & { label?: string; hint?: ReactNode }) {
  const [show, setShow] = useState(false);
  const { t } = useTranslation();
  return (
    <Field.Root className="flex flex-col gap-1 text-sm">
      {label && (
        <Field.Label className="font-medium text-neutral-700 dark:text-neutral-300">
          {label}
        </Field.Label>
      )}
      <div className="relative">
        <Field.Control
          type={show ? "text" : "password"}
          className="w-full rounded-lg border border-neutral-300 px-3 py-2 pr-9 placeholder:text-neutral-400 focus:border-brand-500 focus:outline-none dark:border-neutral-600 dark:placeholder:text-neutral-500"
          {...props}
        />
        <BaseButton
          type="button"
          aria-label={show ? t("common.hideKey") : t("common.showKey")}
          aria-pressed={show}
          onClick={() => setShow((s) => !s)}
          className="absolute inset-y-0 right-0 flex w-9 items-center justify-center rounded-r-lg text-neutral-400 hover:text-neutral-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 dark:text-neutral-500 dark:hover:text-neutral-300"
        >
          {show ? <EyeOffIcon /> : <EyeIcon />}
        </BaseButton>
      </div>
      {hint && (
        <Field.Description className="text-xs text-neutral-400 dark:text-neutral-500">
          {hint}
        </Field.Description>
      )}
    </Field.Root>
  );
}
