import { useTranslation } from "react-i18next";
import { useTip } from "./use-tip";

/**
 * The dim "Tip: …" line — the house hint recipe, so it reads as a footnote
 * next to the composer's pasteHint and the run band's plan peek. Renders
 * nothing when no tip is due; a missing tip is fine, an empty line is not.
 */
export function TipLine({ className = "" }: { className?: string }) {
  const { t } = useTranslation();
  const tip = useTip();
  if (!tip) return null;
  return (
    <p className={`line-clamp-2 text-[11px] text-neutral-500 dark:text-neutral-400 ${className}`}>
      {t("tips.label")}: {tip}
    </p>
  );
}
