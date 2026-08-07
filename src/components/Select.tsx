import { Select as BaseSelect } from "@base-ui-components/react";
import type { ReactNode } from "react";

export interface SelectOption {
  value: string;
  label: string;
  icon?: ReactNode;
}

/**
 * Styled Select over Base UI headless — supports a leading icon per option,
 * rendered in both the trigger and the popup items.
 */
export function Select({
  value,
  onChange,
  options,
  placeholder = "Select…",
  className = "",
}: {
  value: string;
  onChange: (value: string) => void;
  options: SelectOption[];
  placeholder?: string;
  className?: string;
}) {
  const byValue = new Map(options.map((o) => [o.value, o]));

  return (
    <BaseSelect.Root value={value} onValueChange={(v) => v !== null && onChange(v)}>
      <BaseSelect.Trigger
        className={`flex items-center justify-between gap-2 rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm text-neutral-900 hover:border-neutral-400 focus:border-brand-500 focus:outline-none data-[popup-open]:border-brand-500 dark:border-neutral-600 dark:bg-neutral-900 dark:text-neutral-100 dark:hover:border-neutral-500 ${className}`}
      >
        <BaseSelect.Value>
          {(v: string) => {
            const opt = byValue.get(v);
            if (!opt)
              return <span className="text-neutral-400 dark:text-neutral-500">{placeholder}</span>;
            return (
              <span className="flex min-w-0 items-center gap-2">
                {opt.icon}
                <span className="truncate">{opt.label}</span>
              </span>
            );
          }}
        </BaseSelect.Value>
        <BaseSelect.Icon className="text-neutral-400 dark:text-neutral-500">▾</BaseSelect.Icon>
      </BaseSelect.Trigger>
      <BaseSelect.Portal>
        <BaseSelect.Positioner sideOffset={4} className="z-50">
          <BaseSelect.Popup className="max-h-72 min-w-[var(--anchor-width)] overflow-y-auto rounded-lg border border-neutral-200 bg-white py-1 shadow-lg dark:border-neutral-700 dark:bg-neutral-900">
            {options.map((o) => (
              <BaseSelect.Item
                key={o.value}
                value={o.value}
                className="flex cursor-default items-center gap-2 px-3 py-1.5 text-sm text-neutral-900 data-[highlighted]:bg-brand-50 data-[highlighted]:text-brand-900 dark:text-neutral-100 dark:data-[highlighted]:bg-brand-950 dark:data-[highlighted]:text-brand-100"
              >
                {o.icon}
                <BaseSelect.ItemText className="flex-1 truncate">{o.label}</BaseSelect.ItemText>
                <BaseSelect.ItemIndicator className="text-brand-600 dark:text-brand-400">
                  ✓
                </BaseSelect.ItemIndicator>
              </BaseSelect.Item>
            ))}
          </BaseSelect.Popup>
        </BaseSelect.Positioner>
      </BaseSelect.Portal>
    </BaseSelect.Root>
  );
}
