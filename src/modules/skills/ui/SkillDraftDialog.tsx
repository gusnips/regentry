import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Dialog } from "@base-ui-components/react";
import { XIcon } from "@/components/Icon";
import { overlayCard, scrim } from "@/components/chrome";
import { Button } from "@/components/Button";
import { getMessages } from "@/modules/conversation";
import {
  ensureProviderCredential,
  getActiveProvider,
  resolveProviderModel,
} from "@/modules/providers";
import { i18n } from "@/i18n";
import { distillSkillDraft } from "../distill";
import { SkillForm, type SkillSeed } from "./SkillForm";
import { setSkillDraftOpen, useSkillDraftOpen } from "./draft-open";

type Stage =
  | { kind: "working" }
  | { kind: "review"; seed: SkillSeed }
  | { kind: "error"; message: string };

/** The whole pipeline, component-free: transcript → provider → SKILL.md draft → form seed. */
async function distillFor(conversationId: string | null, signal: AbortSignal): Promise<SkillSeed> {
  if (!conversationId) throw new Error(i18n.t("skills.draft.errorNothing"));
  const transcript = await getMessages(conversationId);
  const config = await getActiveProvider();
  // Unreachable — the panel onboards instead of rendering a composer when no
  // provider exists — but a raw crash is worse than a guard.
  if (!config) throw new Error(i18n.t("skills.draft.errorNothing"));
  const resolved = await resolveProviderModel(await ensureProviderCredential(config));
  const parsed = await distillSkillDraft(resolved, transcript, signal);
  return {
    ...(parsed.name ? { name: parsed.name } : {}),
    ...(parsed.description ? { description: parsed.description } : {}),
    sites: parsed.sites,
    body: parsed.body,
  };
}

/**
 * The dialog's inside, mounted only while it is open — mounting IS the reset,
 * so a reopen never shows the last attempt's leftovers, and unmount aborts a
 * distillation nobody is waiting for.
 */
function DraftBody({ conversationId }: { conversationId: string | null }) {
  const { t } = useTranslation();
  const [stage, setStage] = useState<Stage>({ kind: "working" });
  const controllerRef = useRef<AbortController | null>(null);

  const distill = useCallback(() => {
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;
    distillFor(conversationId, controller.signal).then(
      (seed) => {
        if (!controller.signal.aborted) setStage({ kind: "review", seed });
      },
      (e: unknown) => {
        if (!controller.signal.aborted)
          setStage({ kind: "error", message: e instanceof Error ? e.message : String(e) });
      },
    );
  }, [conversationId]);

  useEffect(() => {
    distill();
    return () => controllerRef.current?.abort();
  }, [distill]);

  if (stage.kind === "working") {
    return (
      <p className="animate-pulse py-6 text-center text-sm text-neutral-500 dark:text-neutral-400">
        {t("skills.draft.working")}
      </p>
    );
  }
  if (stage.kind === "error") {
    return (
      <div className="flex flex-col gap-3">
        <p className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700 dark:bg-red-950/50 dark:text-red-300">
          {stage.message}
        </p>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={() => setStage({ kind: "review", seed: {} })}>
            {t("skills.draft.manual")}
          </Button>
          <Button
            onClick={() => {
              setStage({ kind: "working" });
              void distill();
            }}
          >
            {t("skills.draft.retry")}
          </Button>
        </div>
      </div>
    );
  }
  return (
    <SkillForm
      seed={stage.seed}
      onSaved={() => setSkillDraftOpen(false)}
      onCancel={() => setSkillDraftOpen(false)}
    />
  );
}

/**
 * `/skill new` — distill the open conversation into a draft skill and review
 * it before anything is stored. Rendered once by the side panel's App, which
 * passes the active conversation id (a prop, not a store import, so skills/ui
 * never depends back on conversation/ui). The distillation runs right here in
 * the panel page: nothing persists until Save, and with the panel closed
 * there is nobody left to review — so worker-side survival would buy nothing.
 */
export function SkillDraftDialog({ conversationId }: { conversationId: string | null }) {
  const { t } = useTranslation();
  const open = useSkillDraftOpen();

  return (
    <Dialog.Root open={open} onOpenChange={setSkillDraftOpen}>
      <Dialog.Portal>
        <Dialog.Backdrop className={scrim} />
        <Dialog.Popup
          className={`fixed top-1/2 left-1/2 z-50 max-h-[90vh] w-[min(26rem,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 overflow-y-auto p-4 ${overlayCard}`}
        >
          <div className="flex items-start justify-between gap-2">
            <div>
              <Dialog.Title className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">
                {t("skills.draft.title")}
              </Dialog.Title>
              <Dialog.Description className="mt-0.5 text-xs text-neutral-500 dark:text-neutral-400">
                {t("skills.draft.description")}
              </Dialog.Description>
            </div>
            <Dialog.Close
              aria-label={t("common.close")}
              className="rounded-md p-1 text-neutral-400 hover:bg-neutral-100 hover:text-neutral-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 dark:text-neutral-500 dark:hover:bg-neutral-800 dark:hover:text-neutral-300"
            >
              <XIcon />
            </Dialog.Close>
          </div>
          <div className="mt-3">{open && <DraftBody conversationId={conversationId} />}</div>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
