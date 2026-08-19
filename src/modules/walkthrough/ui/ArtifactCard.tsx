import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import type { ArtifactPayload } from "@/shared/protocol";
import { Button } from "@/components/Button";
import { Icon } from "@/components/Icon";
import { listFrames } from "../store";
import { viewerUrl } from "../viewer-url";

/**
 * The run's deliverable, in the transcript.
 *
 * A card, not a step row: everything else in the column is the agent narrating
 * its work, and this is the thing the user actually asked for. It gets a
 * thumbnail and a button, and it is the only row in the panel that leads
 * somewhere outside it — the walkthrough opens full-page, because a document
 * made of screenshots cannot be read in a side panel.
 */

/** Steps — dots down a spine. Used once, so it lives with its one caller. */
function StepsIcon({ size, className }: { size?: number; className?: string }) {
  return (
    <Icon size={size} className={className}>
      <circle cx="6" cy="7" r="1.5" />
      <path d="M11 7h7" />
      <circle cx="6" cy="12" r="1.5" />
      <path d="M11 12h7" />
      <circle cx="6" cy="17" r="1.5" />
      <path d="M11 17h7" />
    </Icon>
  );
}

/**
 * The recording's first captured frame, as an object URL. Read straight from
 * IndexedDB — the panel shares the worker's origin, so nothing has to be
 * messaged across. Revoked on unmount; a recording whose frames are all gaps
 * simply has no thumbnail.
 */
function useThumbnail(recordingId: string): string | null {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let revoked = false;
    let made: string | null = null;
    void listFrames(recordingId)
      .then((frames) => {
        const blob = frames.find((f) => f.blob)?.blob;
        if (!blob || revoked) return;
        made = URL.createObjectURL(blob);
        setUrl(made);
      })
      .catch(() => setUrl(null));
    return () => {
      revoked = true;
      if (made) URL.revokeObjectURL(made);
    };
  }, [recordingId]);
  return url;
}

export function ArtifactCard({ artifact }: { artifact: ArtifactPayload }) {
  const { t } = useTranslation();
  const thumb = useThumbnail(artifact.recordingId);
  const [site] = artifact.sites;

  const flag =
    artifact.status === "partial"
      ? t("walkthrough.card.partial")
      : artifact.status === "truncated"
        ? t("walkthrough.card.truncated")
        : null;

  const open = () => {
    void chrome.tabs.create({ url: viewerUrl(artifact.recordingId) });
  };

  return (
    <div className="max-w-[85%] self-start rounded-lg border border-neutral-200 bg-neutral-50 p-2 dark:border-neutral-700 dark:bg-neutral-800/40">
      <div className="flex items-start gap-2.5">
        {/* The first screen of the process — the fastest way to recognize which
            walkthrough this is in a long thread. */}
        <div className="h-[36px] w-[56px] shrink-0 overflow-hidden rounded border border-neutral-200 bg-neutral-100 dark:border-neutral-700 dark:bg-neutral-900">
          {thumb && <img src={thumb} alt="" className="h-full w-full object-cover object-top" />}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5 text-[11px] font-medium tracking-wide text-brand-600 uppercase dark:text-brand-400">
            <StepsIcon size={12} />
            {t("walkthrough.card.title")}
          </div>
          <div className="truncate text-xs font-medium text-neutral-800 dark:text-neutral-100">
            {artifact.title}
          </div>
          <div className="flex items-center gap-1.5 text-[11px] text-neutral-500 dark:text-neutral-400">
            <span>{t("walkthrough.card.steps", { count: artifact.frames })}</span>
            {site && <span className="truncate">· {site}</span>}
            {flag && (
              // Gold: a recording that stopped short is a measurement of what
              // was caught, not a failure — and never a silent one.
              <span className="rounded-full bg-amber-400/15 px-1.5 text-telemetry">{flag}</span>
            )}
          </div>
        </div>
        <Button size="sm" variant="outline" onClick={open}>
          {t("walkthrough.card.open")}
        </Button>
      </div>
    </div>
  );
}
