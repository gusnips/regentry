import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/Button";
import { useStoredItem } from "@/components/useStoredItem";
import { runBoardItem } from "@/modules/agent/run-queue";
import { setActiveConversation } from "@/modules/conversation/conversations";
import { describeRecurrence } from "../recurrence";
import { deleteSchedule, listSchedules, watchSchedules, MAX_SCHEDULES } from "../store";
import { disarmSchedule } from "../alarms";
import type { Schedule } from "../types";

/** The stored schedules, kept live across writes the worker makes as they fire. */
function useSchedules(): Schedule[] {
  const [rows, setRows] = useState<Schedule[]>([]);
  useEffect(() => {
    let live = true;
    void listSchedules().then((v) => live && setRows(v));
    const unwatch = watchSchedules(setRows);
    return () => {
      live = false;
      unwatch();
    };
  }, []);
  return [...rows].sort((a, b) => a.nextFireAt - b.nextFireAt);
}

/**
 * An absolute time, not "in 4 hours". A schedule is answered by *when*, and a
 * relative reading forces the user to do the arithmetic the row exists to save.
 * Anything inside the week gets a weekday instead of a date — "Tue 09:00" is
 * the shortest form that still says which day.
 */
function formatWhen(ms: number, lang: string): string {
  const ahead = ms - Date.now();
  const nearby = ahead < 6 * 86_400_000 && ahead > -86_400_000;
  return new Date(ms).toLocaleString(
    lang,
    nearby
      ? { weekday: "short", hour: "2-digit", minute: "2-digit" }
      : { dateStyle: "medium", timeStyle: "short" },
  );
}

/** Small inline glyphs — the project ships no icon library. */
function Icon({ children }: { children: React.ReactNode }) {
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
      aria-hidden="true"
    >
      {children}
    </svg>
  );
}

/**
 * Runs live in the service worker — this page is a separate context with no run
 * slot, no driver and no board. So "Run now" asks rather than calls.
 */
function runNow(id: string): void {
  void chrome.runtime.sendMessage({ type: "tabrunner-run-schedule", id });
}

/**
 * Open the schedule's own thread. Setting it active always lands, so a browser
 * that refuses the panel open (it wants a user gesture, and this one crosses an
 * await) still leaves the user one click from the right conversation rather
 * than nowhere.
 */
async function openConversation(conversationId: string): Promise<void> {
  await setActiveConversation(conversationId);
  try {
    const win = await chrome.windows.getCurrent();
    if (win.id !== undefined) await chrome.sidePanel.open({ windowId: win.id });
  } catch {
    // No panel from here — the thread is still the active one when they open it.
  }
}

async function remove(id: string): Promise<void> {
  await deleteSchedule(id);
  await disarmSchedule(id);
}

/**
 * The management surface for work that runs unattended. Deliberately view-and-
 * cancel only: schedules are created by asking in the panel, where the plan gate
 * turns the request into the user's explicit yes. A form here would be a second
 * way to author the same record, with none of that consent attached.
 */
export function SchedulesSection() {
  const { t, i18n } = useTranslation();
  const schedules = useSchedules();
  const board = useStoredItem(runBoardItem);
  const busyOn = board.running?.conversationId;

  return (
    <section>
      <div className="flex items-baseline justify-between gap-4">
        <h2 className="text-base font-semibold text-neutral-900 dark:text-neutral-100">
          {t("schedule.ui.title")}
        </h2>
        {schedules.length > 0 && (
          <span className="shrink-0 text-xs text-neutral-500 tabular-nums dark:text-neutral-400">
            {/* `n`, not `count`: an i18next `count` option means pluralization,
                and this is a ratio, not a quantity being pluralized. */}
            {t("schedule.ui.count", { n: schedules.length, max: MAX_SCHEDULES })}
          </span>
        )}
      </div>
      <p className="mt-1 text-xs text-neutral-500 dark:text-neutral-400">{t("schedule.ui.help")}</p>

      {schedules.length === 0 ? (
        <div className="mt-3 rounded-lg bg-neutral-50 px-3 py-3 dark:bg-neutral-900/50">
          <p className="text-sm font-medium text-neutral-700 dark:text-neutral-200">
            {t("schedule.ui.emptyTitle")}
          </p>
          <p className="mt-1 text-xs text-neutral-500 dark:text-neutral-400">
            {t("schedule.ui.emptyBody")}
          </p>
          <p className="mt-2 text-xs text-neutral-600 dark:text-neutral-300">
            {t("schedule.ui.emptyAction")}
          </p>
        </div>
      ) : (
        <ul className="mt-3 space-y-1.5">
          {schedules.map((s) => {
            const running = busyOn === s.conversationId;
            return (
              <li
                key={s.id}
                className="flex items-start justify-between gap-3 rounded-lg bg-neutral-50 px-3 py-2 dark:bg-neutral-900/50"
              >
                <div className="min-w-0 flex-1">
                  <p className="text-sm leading-relaxed text-neutral-800 dark:text-neutral-200">
                    {s.task}
                  </p>
                  <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-neutral-500 dark:text-neutral-400">
                    <span>{describeRecurrence(s.recurrence)}</span>
                    <span aria-hidden="true">·</span>
                    {/* The row's one live number — gold measures, per the two-lights rule. */}
                    <span className="telemetry tabular-nums">
                      {running
                        ? t("schedule.ui.running")
                        : t("schedule.ui.next", {
                            when: formatWhen(s.nextFireAt, i18n.language),
                          })}
                    </span>
                    {s.lastRun && (
                      <>
                        <span aria-hidden="true">·</span>
                        <span className={s.lastRun.ok ? "" : "text-red-600 dark:text-red-400"}>
                          {t(s.lastRun.ok ? "schedule.ui.lastOk" : "schedule.ui.lastFailed", {
                            when: formatWhen(s.lastRun.at, i18n.language),
                          })}
                        </span>
                      </>
                    )}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-0.5">
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={running}
                    aria-label={t("schedule.ui.runNow")}
                    title={t("schedule.ui.runNow")}
                    onClick={() => runNow(s.id)}
                  >
                    <Icon>
                      <path d="M6 4l14 8-14 8V4z" />
                    </Icon>
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    aria-label={t("schedule.ui.open")}
                    title={t("schedule.ui.open")}
                    onClick={() => void openConversation(s.conversationId)}
                  >
                    <Icon>
                      <path d="M21 3h-7" />
                      <path d="M21 3v7" />
                      <path d="M21 3 10 14" />
                      <path d="M19 14v5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h5" />
                    </Icon>
                  </Button>
                  <Button
                    variant="ghost-danger"
                    size="sm"
                    aria-label={t("schedule.ui.delete")}
                    title={t("schedule.ui.delete")}
                    onClick={() => void remove(s.id)}
                  >
                    <Icon>
                      <path d="M3 6h18" />
                      <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" />
                      <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                    </Icon>
                  </Button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
