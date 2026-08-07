import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import type { ThemeMode } from "@/lib/theme";
import { themeMode } from "@/lib/theme";
import { SegmentedControl } from "./SegmentedControl";
import type { SegmentedOption } from "./SegmentedControl";

/** Current theme preference, live-synced across contexts via storage watch. */
export function useThemeMode(): [ThemeMode, (mode: ThemeMode) => void] {
  const [mode, setMode] = useState<ThemeMode>("system");
  useEffect(() => {
    void themeMode.get().then(setMode);
    return themeMode.watch(setMode);
  }, []);
  return [mode, (m) => void themeMode.set(m)];
}

function SunIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      aria-hidden
    >
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2m0 16v2M4.93 4.93l1.41 1.41m11.32 11.32 1.41 1.41M2 12h2m16 0h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41" />
    </svg>
  );
}

function MoonIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
    </svg>
  );
}

function MonitorIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <rect x="2" y="3" width="20" height="14" rx="2" />
      <path d="M8 21h8m-4-4v4" />
    </svg>
  );
}

/** Theme picker — all three modes visible, so "System" never hides behind a toggle. */
export function ThemeToggle({ className }: { className?: string }) {
  const { t } = useTranslation();
  const [mode, setMode] = useThemeMode();
  const options: SegmentedOption<ThemeMode>[] = [
    { value: "system", label: <MonitorIcon />, title: t("settings.themeSystem") },
    { value: "light", label: <SunIcon />, title: t("settings.themeLight") },
    { value: "dark", label: <MoonIcon />, title: t("settings.themeDark") },
  ];
  return (
    <SegmentedControl
      value={mode}
      onChange={setMode}
      options={options}
      ariaLabel={t("settings.appearance")}
      className={className}
    />
  );
}
