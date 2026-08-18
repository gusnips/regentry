import { useTranslation } from "react-i18next";
import { Dialog } from "@base-ui-components/react";
import { XIcon } from "@/components/Icon";
import { overlayCard, scrim } from "@/components/chrome";
import type { Skill } from "../types";
import { SkillForm } from "./SkillForm";

/** New/Edit dialog on the options page — a thin shell around the one SkillForm. */
export function SkillEditorDialog({
  open,
  skill,
  onClose,
}: {
  open: boolean;
  /** Present = edit this skill; absent = create a new one. */
  skill?: Skill;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  return (
    <Dialog.Root open={open} onOpenChange={(next) => !next && onClose()}>
      <Dialog.Portal>
        <Dialog.Backdrop className={scrim} />
        <Dialog.Popup
          className={`fixed top-1/2 left-1/2 z-50 max-h-[90vh] w-[min(30rem,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 overflow-y-auto p-4 ${overlayCard}`}
        >
          <div className="flex items-start justify-between gap-2">
            <Dialog.Title className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">
              {skill ? t("skills.editTitle", { name: skill.name }) : t("skills.newTitle")}
            </Dialog.Title>
            <Dialog.Close
              aria-label={t("common.close")}
              className="rounded-md p-1 text-neutral-400 hover:bg-neutral-100 hover:text-neutral-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 dark:text-neutral-500 dark:hover:bg-neutral-800 dark:hover:text-neutral-300"
            >
              <XIcon />
            </Dialog.Close>
          </div>
          <div className="mt-3">
            {/* Keyed so switching between rows never leaks one skill's draft state into another's. */}
            <SkillForm key={skill?.id ?? "new"} seed={skill} onSaved={onClose} onCancel={onClose} />
          </div>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
