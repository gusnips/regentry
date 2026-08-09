import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { AddProviderDialog, ProviderList } from "@/modules/providers/ui";
import { InstructionsSection, MemorySection } from "@/modules/memory/ui";
import { Button } from "@/components/Button";
import { Icon } from "@/components/Icon";
import { Switch } from "@/components/Switch";
import { TextField } from "@/components/TextField";
import { useStoredItem } from "@/components/useStoredItem";
import { ThemeToggle } from "@/components/ThemeControl";
import { LanguageToggle } from "@/components/LanguageToggle";
import { defaultStartUrl, tipsEnabled, widgetHidden } from "@/lib/prefs";
import { StatusStrip } from "./StatusStrip";
import { McpPane } from "./McpPane";

const PAGES = ["general", "behavior", "knowledge", "providers", "mcp"] as const;
type PageId = (typeof PAGES)[number];

/** The hash is the page's deep link — a reload or a copied URL lands back here. */
function pageFromHash(): PageId {
  const hash = window.location.hash.slice(1);
  return (PAGES as readonly string[]).includes(hash) ? (hash as PageId) : "general";
}

/** A start page a background run can actually open — full http(s) URL only. */
function validStartUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

/** One rail destination — quiet until it's the page you're on. */
function NavItem({
  active,
  label,
  onClick,
  children,
}: {
  active: boolean;
  label: string;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <Button
      variant="nav"
      aria-current={active ? "page" : undefined}
      className="flex w-full items-center justify-start gap-2"
      onClick={onClick}
    >
      <Icon>{children}</Icon>
      {label}
    </Button>
  );
}

function GeneralPane() {
  const { t } = useTranslation();
  return (
    <section className="flex flex-wrap items-start gap-x-10 gap-y-4">
      <div>
        <h2 className="text-base font-semibold text-neutral-900 dark:text-neutral-100">
          {t("settings.appearance")}
        </h2>
        <div className="mt-3">
          <ThemeToggle />
        </div>
      </div>
      <div>
        <h2 className="text-base font-semibold text-neutral-900 dark:text-neutral-100">
          {t("settings.language")}
        </h2>
        <div className="mt-3">
          <LanguageToggle />
        </div>
      </div>
    </section>
  );
}

function BehaviorPane() {
  const { t } = useTranslation();
  // Stored inverted ("hidden") so the default needs no write; shown as the
  // positive toggle.
  const hidden = useStoredItem(widgetHidden);
  const tips = useStoredItem(tipsEnabled);
  const stored = useStoredItem(defaultStartUrl);
  // Edited locally, persisted on blur — a half-typed URL must never reach a run.
  const [startUrl, setStartUrl] = useState<string | null>(null);
  const [urlError, setUrlError] = useState(false);
  const urlValue = startUrl ?? stored;

  const commitStartUrl = () => {
    const value = urlValue.trim();
    if (validStartUrl(value)) {
      setUrlError(false);
      void defaultStartUrl.set(value);
      setStartUrl(null);
    } else {
      // Keep the text with the error under it — the fix happens here, and
      // nothing invalid ever reaches the store.
      setUrlError(true);
    }
  };

  return (
    <>
      {/* Dispatch-and-forget knobs: where background tasks open, and whether
          the floating indicator reports them on the active tab. */}
      <section>
        <h2 className="text-base font-semibold text-neutral-900 dark:text-neutral-100">
          {t("settings.backgroundTasks")}
        </h2>
        <div className="mt-3 flex items-start justify-between gap-4">
          <div>
            <div className="text-sm font-medium text-neutral-800 dark:text-neutral-200">
              {t("settings.showWidget")}
            </div>
            <p className="mt-1 text-xs text-neutral-500 dark:text-neutral-400">
              {t("settings.showWidgetHint")}
            </p>
          </div>
          <Switch
            checked={!hidden}
            onChange={(v) => void widgetHidden.set(!v)}
            ariaLabel={t("settings.showWidget")}
          />
        </div>
        <div className="mt-4">
          <TextField
            label={t("settings.defaultStartUrl")}
            hint={
              urlError ? (
                <span className="text-red-600 dark:text-red-400">{t("settings.invalidUrl")}</span>
              ) : (
                t("settings.defaultStartUrlHint")
              )
            }
            value={urlValue}
            onChange={(e) => {
              setStartUrl(e.target.value);
              if (urlError) setUrlError(false);
            }}
            onBlur={commitStartUrl}
            placeholder={defaultStartUrl.fallback}
            inputMode="url"
            spellCheck={false}
            aria-invalid={urlError || undefined}
          />
        </div>
      </section>

      {/* Panel-only chrome — nothing here touches a background run. */}
      <section className="mt-8">
        <h2 className="text-base font-semibold text-neutral-900 dark:text-neutral-100">
          {t("settings.sidePanel")}
        </h2>
        <div className="mt-3 flex items-start justify-between gap-4">
          <div>
            <div className="text-sm font-medium text-neutral-800 dark:text-neutral-200">
              {t("settings.showTips")}
            </div>
            <p className="mt-1 text-xs text-neutral-500 dark:text-neutral-400">
              {t("settings.showTipsHint")}
            </p>
          </div>
          <Switch
            checked={tips}
            onChange={(v) => void tipsEnabled.set(v)}
            ariaLabel={t("settings.showTips")}
          />
        </div>
      </section>
    </>
  );
}

function ProvidersPane() {
  const { t } = useTranslation();
  return (
    <section>
      <div className="flex items-center justify-between">
        <h2 className="text-base font-semibold text-neutral-900 dark:text-neutral-100">
          {t("settings.providers")}
        </h2>
        <AddProviderDialog trigger={<Button size="sm">{t("settings.addProvider")}</Button>} />
      </div>
      <div className="mt-3">
        <ProviderList />
      </div>
    </section>
  );
}

export default function App() {
  const { t } = useTranslation();
  const [page, setPage] = useState<PageId>(pageFromHash);

  useEffect(() => {
    const onHash = () => setPage(pageFromHash());
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  const go = (id: PageId) => {
    setPage(id);
    // No per-page history stack, no scroll-to-anchor — the hash is a bookmark.
    window.history.replaceState(null, "", `#${id}`);
  };

  return (
    <div className="mx-auto max-w-3xl p-6">
      <h1 className="flex items-center gap-2 text-lg font-semibold text-neutral-900 dark:text-neutral-100">
        <img src="/icon.svg" className="h-6 w-6" alt="" />
        {t("settings.pageTitle")}
      </h1>

      <StatusStrip onAddProvider={() => go("providers")} />

      <div className="mt-6 flex items-start gap-6">
        <nav aria-label={t("settings.pageTitle")} className="flex w-40 shrink-0 flex-col gap-0.5">
          <NavItem
            active={page === "general"}
            label={t("settings.nav.general")}
            onClick={() => go("general")}
          >
            <path d="M4 6h10" />
            <path d="M18 6h2" />
            <circle cx="16" cy="6" r="2" />
            <path d="M4 12h2" />
            <path d="M10 12h10" />
            <circle cx="8" cy="12" r="2" />
            <path d="M4 18h12" />
            <circle cx="18" cy="18" r="2" />
          </NavItem>
          <NavItem
            active={page === "behavior"}
            label={t("settings.nav.behavior")}
            onClick={() => go("behavior")}
          >
            <path d="M13 2 3 14h7l-1 8 10-12h-7l1-8z" />
          </NavItem>
          <NavItem
            active={page === "knowledge"}
            label={t("settings.nav.knowledge")}
            onClick={() => go("knowledge")}
          >
            <path d="M2 4h6a4 4 0 0 1 4 4v12a3 3 0 0 0-3-3H2z" />
            <path d="M22 4h-6a4 4 0 0 0-4 4v12a3 3 0 0 1 3-3h7z" />
          </NavItem>
          <NavItem
            active={page === "providers"}
            label={t("settings.nav.providers")}
            onClick={() => go("providers")}
          >
            <circle cx="7.5" cy="15.5" r="4.5" />
            <path d="m11 12 10-10" />
            <path d="m16 5 3 3" />
          </NavItem>
          <NavItem active={page === "mcp"} label={t("settings.nav.mcp")} onClick={() => go("mcp")}>
            <path d="M9 2v6" />
            <path d="M15 2v6" />
            <path d="M6 8h12v4a6 6 0 0 1-12 0V8z" />
            <path d="M12 18v4" />
          </NavItem>
        </nav>

        <main className="min-w-0 flex-1">
          {page === "general" && <GeneralPane />}
          {page === "behavior" && <BehaviorPane />}
          {page === "knowledge" && (
            /* The module sections carry their own mt-8 — flush the first. */
            <div className="[&>section:first-child]:mt-0">
              <InstructionsSection />
              <MemorySection />
            </div>
          )}
          {page === "providers" && <ProvidersPane />}
          {page === "mcp" && <McpPane />}
        </main>
      </div>
    </div>
  );
}
