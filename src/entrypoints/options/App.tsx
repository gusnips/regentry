import { AddProviderDialog, ProviderList } from "@/modules/providers/ui";
import { Button } from "@/components/Button";
import { Select } from "@/components/Select";
import { useThemeMode } from "@/components/ThemeButton";
import type { ThemeMode } from "@/lib/theme";

const THEME_OPTIONS: { value: ThemeMode; label: string }[] = [
  { value: "system", label: "System — follow the OS" },
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
];

export default function App() {
  const [mode, setMode] = useThemeMode();

  return (
    <div className="mx-auto max-w-xl p-6">
      <h1 className="flex items-center gap-2 text-lg font-semibold text-neutral-900 dark:text-neutral-100">
        <img src="/icon.svg" className="h-6 w-6" alt="" />
        Regent settings
      </h1>

      <section className="mt-6">
        <h2 className="text-base font-semibold text-neutral-900 dark:text-neutral-100">
          Appearance
        </h2>
        <div className="mt-3">
          <Select value={mode} onChange={(v) => setMode(v as ThemeMode)} options={THEME_OPTIONS} />
        </div>
      </section>

      <section className="mt-6">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-semibold text-neutral-900 dark:text-neutral-100">
            Providers
          </h2>
          <AddProviderDialog trigger={<Button size="sm">Add provider</Button>} />
        </div>
        <div className="mt-3">
          <ProviderList />
        </div>
      </section>
    </div>
  );
}
