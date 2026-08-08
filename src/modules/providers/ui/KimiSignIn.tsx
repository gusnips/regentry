import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/Button";
import { requestDeviceCode, pollForToken, SignInError } from "../kimi-oauth";
import type { DevicePrompt, SignInFailure } from "../kimi-oauth";
import type { OAuthCredential } from "../types";

type Phase =
  | { step: "idle" }
  | { step: "starting" }
  | { step: "waiting"; prompt: DevicePrompt }
  | { step: "failed"; reason: SignInFailure }
  | { step: "error"; message: string };

/**
 * Device-code sign-in, start to finish. Regentry asks Kimi for a code, opens
 * the approval page with it pre-filled, and polls until the user approves —
 * so the only thing the user must do is confirm a code that is on screen in
 * front of them.
 *
 * Every ending is actionable: expiry and refusal both offer a fresh start,
 * and the code stays visible in case the tab never opened.
 */
export function KimiSignIn({
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

  // A dialog closed mid-poll must not leave a fetch loop running behind it.
  useEffect(() => () => abort.current?.abort(), []);

  const start = useCallback(async () => {
    abort.current?.abort();
    const controller = new AbortController();
    abort.current = controller;
    setPhase({ step: "starting" });

    try {
      const prompt = await requestDeviceCode();
      setPhase({ step: "waiting", prompt });
      // Pre-filled approval page. If the browser blocks it, the code below is
      // the fallback — that's why it stays on screen while we wait.
      void chrome.tabs.create({ url: prompt.verificationUrl });

      const credential = await pollForToken(prompt, controller.signal);
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
        <span className="text-xs text-neutral-600 dark:text-neutral-300">
          {t("providerForm.signInCodeLabel")}
        </span>
        <span className="text-center font-mono text-xl font-semibold tracking-[0.2em] text-neutral-900 dark:text-neutral-50">
          {phase.prompt.userCode}
        </span>
        <p className="text-xs text-neutral-600 dark:text-neutral-300">
          {t("providerForm.signInOpened")}
        </p>
        <p className="text-xs text-neutral-500 dark:text-neutral-400">
          {t("providerForm.signInBlocked", { url: phase.prompt.verificationUrl })}
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
              ? t("providerForm.signInExpiredTitle")
              : t("providerForm.signInDeniedTitle")}
        </span>
        {phase.step === "failed" && (
          <span className="text-xs text-amber-800 dark:text-amber-200">
            {expired ? t("providerForm.signInExpiredBody") : t("providerForm.signInDeniedBody")}
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
            : t("providerForm.signInStart")}
      </Button>
      {!signedIn && (
        <span className="text-xs text-neutral-500 dark:text-neutral-400">
          {t("providerForm.signInHint")}
        </span>
      )}
    </div>
  );
}
