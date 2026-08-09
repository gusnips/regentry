import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/Button";
import { ProviderIcon } from "./ProviderIcon";
import { OAUTH_FLOWS } from "../oauth-flows";
import type { SignInPrompt } from "../oauth-flows";
import { providerDisplayName } from "../presets";
import type { ProviderPreset } from "../presets";
import { SignInError } from "../types";
import type { OAuthCredential, SignInFailure } from "../types";

/**
 * How long the "connected" card stays up before the dialog closes over it.
 * Its animation sequence (theme.css) finishes around 820ms, so this is that
 * plus a beat to read the account name.
 */
export const SIGN_IN_DONE_MS = 2000;

type Phase =
  | { step: "idle" }
  | { step: "starting" }
  | { step: "waiting"; prompt: SignInPrompt }
  | { step: "done"; account?: string }
  | { step: "failed"; reason: SignInFailure }
  | { step: "error"; message: string };

/**
 * Subscription sign-in for any OAuth provider. TabRunner opens the vendor's
 * approval page, captures the answer, and saves the credential the moment it
 * arrives — approving that page is the whole flow.
 *
 * Every ending is actionable: success confirms the account it connected,
 * expiry and refusal both offer a fresh start, and the approval link stays
 * visible in case the tab never opened.
 */
export function OAuthSignIn({
  preset,
  signedIn,
  onSignedIn,
}: {
  /** The preset being connected — names the copy, and marks the connected card. */
  preset: ProviderPreset;
  /** Existing credential — the button then offers re-authenticating. */
  signedIn?: OAuthCredential;
  /** Persists the credential; a rejection is shown as the sign-in's failure. */
  onSignedIn: (credential: OAuthCredential) => Promise<void>;
}) {
  const { t } = useTranslation();
  const [phase, setPhase] = useState<Phase>({ step: "idle" });
  const abort = useRef<AbortController | null>(null);
  // Every line of copy names the provider — no string in this file names a vendor.
  const provider = providerDisplayName(preset);
  const presetId = preset.id;

  // A dialog closed mid-sign-in must not leave a tab-watcher or poll running behind it.
  useEffect(() => () => abort.current?.abort(), []);

  const start = useCallback(async () => {
    const flow = OAUTH_FLOWS[presetId];
    if (!flow) return; // Unreachable: only `auth: "oauth"` presets render this card.
    abort.current?.abort();
    const controller = new AbortController();
    abort.current = controller;
    setPhase({ step: "starting" });

    try {
      const credential = await flow.signIn(controller.signal, (prompt) =>
        setPhase({ step: "waiting", prompt }),
      );
      if (controller.signal.aborted) return;
      await onSignedIn(credential);
      if (controller.signal.aborted) return;
      setPhase({ step: "done", ...(credential.account ? { account: credential.account } : {}) });
    } catch (e) {
      if (controller.signal.aborted) return;
      if (e instanceof SignInError) {
        if (e.reason === "cancelled") setPhase({ step: "idle" });
        else setPhase({ step: "failed", reason: e.reason });
        return;
      }
      setPhase({ step: "error", message: e instanceof Error ? e.message : String(e) });
    }
  }, [presetId, onSignedIn]);

  const cancel = () => {
    abort.current?.abort();
    setPhase({ step: "idle" });
  };

  if (phase.step === "waiting") {
    const host = hostOf(phase.prompt.url);
    return (
      <div className="flex flex-col gap-2 rounded-lg border border-brand-200 bg-brand-50 p-3 dark:border-brand-800 dark:bg-brand-950">
        {phase.prompt.userCode && (
          <>
            <span className="text-xs text-neutral-600 dark:text-neutral-300">
              {t("providerForm.signInCodeLabel", { host })}
            </span>
            <span className="text-center font-mono text-xl font-semibold tracking-[0.2em] text-neutral-900 dark:text-neutral-50">
              {phase.prompt.userCode}
            </span>
          </>
        )}
        <p className="text-xs text-neutral-600 dark:text-neutral-300">
          {t("providerForm.signInOpened", { host })}
        </p>
        <p className="text-xs text-neutral-500 dark:text-neutral-400">
          {t("providerForm.signInBlocked")}{" "}
          {/* The href is a 400-character PKCE URL — nobody reads that, so the
              link wears the host it goes to and keeps the URL in its tooltip. */}
          <a
            className="font-medium text-brand-600 hover:underline dark:text-brand-400"
            href={phase.prompt.url}
            title={phase.prompt.url}
            target="_blank"
            rel="noreferrer"
          >
            {host} ↗
          </a>
        </p>
        <div className="flex items-center justify-between gap-2 pt-1">
          <span
            className="text-xs font-medium text-brand-700 dark:text-brand-300"
            role="status"
            aria-live="polite"
          >
            {t("providerForm.signInWaiting")}
          </span>
          <Button type="button" variant="ghost" size="sm" onClick={cancel}>
            {t("providerForm.signInCancel")}
          </Button>
        </div>
      </div>
    );
  }

  if (phase.step === "done") {
    return (
      <div
        role="status"
        aria-live="polite"
        // Clips the ring at the card's edge rather than letting it bleed past.
        className="connected-card flex flex-col items-center gap-2 overflow-hidden rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-4 text-center dark:border-emerald-900 dark:bg-emerald-950"
      >
        <span className="relative inline-flex">
          <span
            aria-hidden
            className="connected-ring absolute inset-0 rounded-full border-2 border-emerald-400 dark:border-emerald-500"
          />
          <span className="connected-tile inline-flex">
            <ProviderIcon icon={preset.icon} size={36} />
          </span>
          <span
            aria-hidden
            className="connected-badge absolute -right-1.5 -bottom-1.5 inline-flex h-5 w-5 items-center justify-center rounded-full bg-emerald-500 ring-2 ring-emerald-50 dark:bg-emerald-400 dark:ring-emerald-950"
          >
            <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" aria-hidden>
              <path
                className="connected-check"
                d="M4 8.4 6.7 11.1 12 5.6"
                fill="none"
                stroke="#fff"
                strokeWidth="2.2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </span>
        </span>
        <span className="connected-title text-sm font-medium text-emerald-900 dark:text-emerald-100">
          {t("providerForm.signInConnected", { provider })}
        </span>
        {/* Anonymous credentials skip the second line: "Signed in" under
            "Connected to X" is the same sentence twice. */}
        {phase.account && (
          <span className="connected-account max-w-full truncate text-xs text-emerald-800 dark:text-emerald-200">
            {t("providerForm.signInDone", { account: phase.account })}
          </span>
        )}
      </div>
    );
  }

  if (phase.step === "failed" || phase.step === "error") {
    const expired = phase.step === "failed" && phase.reason === "expired";
    return (
      <div
        role="alert"
        className="flex flex-col gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 dark:border-amber-900 dark:bg-amber-950"
      >
        <span className="text-sm font-medium text-amber-900 dark:text-amber-100">
          {phase.step === "error"
            ? phase.message
            : expired
              ? t("providerForm.signInExpiredTitle")
              : t("providerForm.signInDeniedTitle")}
        </span>
        {phase.step === "failed" && (
          <span className="text-xs text-amber-800 dark:text-amber-200">
            {expired
              ? t("providerForm.signInExpiredBody")
              : t("providerForm.signInDeniedBody", { provider })}
          </span>
        )}
        <Button type="button" size="sm" className="self-start" onClick={() => void start()}>
          {t("providerForm.signInRetry")}
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-1.5">
      {signedIn && (
        <span className="text-xs text-neutral-500 dark:text-neutral-400">
          {signedIn.account
            ? t("providerForm.signInDone", { account: signedIn.account })
            : t("providerForm.signInDoneAnon")}
        </span>
      )}
      <Button
        type="button"
        variant={signedIn ? "ghost" : "primary"}
        disabled={phase.step === "starting"}
        onClick={() => void start()}
      >
        {/* Nothing is open yet at "starting" — saying "waiting for approval"
            there would name a page the user hasn't been shown. */}
        {phase.step === "starting"
          ? t("providerForm.signInStarting")
          : signedIn
            ? t("providerForm.signInAgain")
            : t("providerForm.signInStart", { provider })}
      </Button>
      {!signedIn && (
        <span className="text-xs text-neutral-500 dark:text-neutral-400">
          {t("providerForm.signInHint", { provider })}
        </span>
      )}
    </div>
  );
}

/** The vendor's own domain — the copy names where to approve, not who wrote the page. */
function hostOf(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}
