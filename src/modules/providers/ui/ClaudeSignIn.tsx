import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/Button";
import { signInWithClaude } from "../claude-oauth";
import { SignInError } from "../types";
import type { OAuthCredential, SignInFailure } from "../types";

type Phase =
  | { step: "idle" }
  | { step: "starting" }
  | { step: "waiting"; authorizeUrl: string }
  | { step: "failed"; reason: SignInFailure }
  | { step: "error"; message: string };

/**
 * OAuth sign-in for a Claude subscription (Pro/Max). Regentry opens the
 * claude.ai approval page in a new tab, captures the localhost redirect, and
 * exchanges the code — the only thing the user must do is approve on that page.
 *
 * Every ending is actionable: expiry and refusal both offer a fresh start, and
 * the authorize link stays visible in case the tab never opened.
 */
export function ClaudeSignIn({
  signedIn,
  onSignedIn,
}: {
  /** Existing credential — the button then offers re-authenticating. */
  signedIn?: OAuthCredential;
  onSignedIn: (credential: OAuthCredential) => void;
}) {
  const { t } = useTranslation();
  const [phase, setPhase] = useState<Phase>({ step: "idle" });
  const abort = useRef<AbortController | null>(null);

  // A dialog closed mid-sign-in must not leave the tab-watcher running behind it.
  useEffect(() => () => abort.current?.abort(), []);

  const start = useCallback(async () => {
    abort.current?.abort();
    const controller = new AbortController();
    abort.current = controller;
    setPhase({ step: "starting" });

    try {
      const credential = await signInWithClaude(controller.signal, (authorizeUrl) =>
        setPhase({ step: "waiting", authorizeUrl }),
      );
      if (controller.signal.aborted) return;
      setPhase({ step: "idle" });
      onSignedIn(credential);
    } catch (e) {
      if (controller.signal.aborted) return;
      if (e instanceof SignInError) {
        if (e.reason === "cancelled") setPhase({ step: "idle" });
        else setPhase({ step: "failed", reason: e.reason });
        return;
      }
      setPhase({ step: "error", message: e instanceof Error ? e.message : String(e) });
    }
  }, [onSignedIn]);

  const cancel = () => {
    abort.current?.abort();
    setPhase({ step: "idle" });
  };

  if (phase.step === "waiting") {
    return (
      <div className="flex flex-col gap-2 rounded-lg border border-brand-200 bg-brand-50 p-3 dark:border-brand-800 dark:bg-brand-950">
        <p className="text-xs text-neutral-600 dark:text-neutral-300">
          {t("providerForm.claudeSignInOpened")}
        </p>
        <p className="text-xs text-neutral-500 dark:text-neutral-400">
          {t("providerForm.claudeSignInBlocked")}{" "}
          <a
            className="text-brand-600 break-all hover:underline dark:text-brand-400"
            href={phase.authorizeUrl}
            target="_blank"
            rel="noreferrer"
          >
            {phase.authorizeUrl}
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
              ? t("providerForm.claudeSignInExpiredTitle")
              : t("providerForm.signInDeniedTitle")}
        </span>
        {phase.step === "failed" && (
          <span className="text-xs text-amber-800 dark:text-amber-200">
            {expired
              ? t("providerForm.claudeSignInExpiredBody")
              : t("providerForm.claudeSignInDeniedBody")}
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
        {phase.step === "starting"
          ? t("providerForm.signInWaiting")
          : signedIn
            ? t("providerForm.signInAgain")
            : t("providerForm.claudeSignInStart")}
      </Button>
      {!signedIn && (
        <span className="text-xs text-neutral-500 dark:text-neutral-400">
          {t("providerForm.claudeSignInHint")}
        </span>
      )}
    </div>
  );
}
