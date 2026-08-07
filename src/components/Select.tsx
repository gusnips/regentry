import { Select as BaseSelect } from "@base-ui-components/react";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";

export interface SelectOption {
  value: string;
  label: string;
  icon?: ReactNode;
}

type Size = "sm" | "md";

/** sm = panel-header density, md = forms. */
const SIZES: Record<Size, { trigger: string; item: string }> = {
  md: { trigger: "px-3 py-2 text-sm", item: "px-3 py-1.5 text-sm" },
  sm: { trigger: "px-2 py-1 text-xs", item: "px-2 py-1 text-xs" },
};

/**
 * Styled Select over Base UI headless — supports a leading icon per option,
 * rendered in both the trigger and the popup items. The popup grows past the
 * trigger width (up to max-w-72) so long values like model ids stay readable.
 */
export function Select({
  value,
  onChange,
  options,
  placeholder,
  className = "",
  size = "md",
  title,
  ariaLabel,
}: {
  value: string;
  onChange: (value: string) => void;
  options: SelectOption[];
  placeholder?: string;
  className?: string;
  size?: Size;
  title?: string;
  ariaLabel?: string;
}) {
  const { t } = useTranslation();
  const byValue = new Map(options.map((o) => [o.value, o]));
  const s = SIZES[size];

  return (
    <BaseSelect.Root value={value} onValueChange={(v) => v !== null && onChange(v)}>
      <BaseSelect.Trigger
        title={title}
        aria-label={ariaLabel}
        className={`flex items-center justify-between gap-2 rounded-lg border border-neutral-300 bg-white text-neutral-900 hover:border-neutral-400 focus:border-brand-500 focus:outline-none data-[popup-open]:border-brand-500 dark:border-neutral-600 dark:bg-neutral-900 dark:text-neutral-100 dark:hover:border-neutral-500 ${s.trigger} ${className}`}
      >
        <BaseSelect.Value>
          {(v: string) => {
            const opt = byValue.get(v);
            if (!opt)
              return (
                <span className="text-neutral-400 dark:text-neutral-500">
                  {placeholder ?? t("common.selectPlaceholder")}
                </span>
              );
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
        {/* alignItemWithTrigger would center the SELECTED item on the trigger, pushing
            earlier options above the viewport in a short side panel — they got clipped
            and looked missing. A plain dropdown always shows the list from the top. */}
        <BaseSelect.Positioner sideOffset={4} alignItemWithTrigger={false} className="z-50">
          <BaseSelect.Popup className="max-h-72 w-max min-w-[var(--anchor-width)] max-w-72 overflow-y-auto rounded-lg border border-neutral-200 bg-white py-1 shadow-lg dark:border-neutral-700 dark:bg-neutral-900">
            {options.map((o) => (
              <BaseSelect.Item
                key={o.value}
                value={o.value}
                className={`flex cursor-default items-center gap-2 text-neutral-900 data-[highlighted]:bg-brand-50 data-[highlighted]:text-brand-900 dark:text-neutral-100 dark:data-[highlighted]:bg-brand-950 dark:data-[highlighted]:text-brand-100 ${s.item}`}
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
