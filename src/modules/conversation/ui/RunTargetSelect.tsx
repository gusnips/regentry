import { useTranslation } from "react-i18next";
import { useConversationStore } from "./store";
import { Select } from "@/components/Select";
import { Icon } from "@/components/Icon";

/** Two stacked pages — the run gets its own tab, behind yours. */
function BackgroundIcon() {
  return (
    <Icon>
      <rect x="8" y="3" width="13" height="13" rx="2" />
      <path d="M16 19v1a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V10a2 2 0 0 1 2-2h1" />
    </Icon>
  );
}

/** One page with an arrow into it — the run drives what you're looking at. */
function ThisPageIcon() {
  return (
    <Icon>
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <path d="M12 7v8m-3.5-3.5L12 15l3.5-3.5" />
    </Icon>
  );
}

/**
 * Where the next run drives, as the composer footer's left anchor — icon +
 * label trigger (the footer row exists anyway, so the self-explanatory label
 * is free), full option text in the popup. The row is permanent because of
 * this control, so transient hints on the right never shift the layout.
 */
export function RunTargetSelect() {
  const { t } = useTranslation();
  const runTarget = useConversationStore((s) => s.runTarget);
  const setRunTarget = useConversationStore((s) => s.setRunTarget);

  return (
    <Select
      size="sm"
      variant="quiet"
      className="shrink-0"
      ariaLabel={t("run.targetTitle")}
      title={t("run.targetTitle")}
      value={runTarget}
      onChange={(v) => setRunTarget(v === "thisPage" ? "thisPage" : "background")}
      options={[
        { value: "background", label: t("run.background"), icon: <BackgroundIcon /> },
        { value: "thisPage", label: t("run.thisPage"), icon: <ThisPageIcon /> },
      ]}
    />
  );
}
