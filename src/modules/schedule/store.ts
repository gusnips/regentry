import { defineItem } from "@/lib/storage";
import { i18n } from "@/i18n";
import type { Schedule } from "./types";

/**
 * ponytail: one flat array in `chrome.storage.local`, read-modify-written whole
 * — the same shape the conversation index uses, and for the same reason (there
 * are tens of these, not thousands). Ceiling: every write rewrites the list.
 * Upgrade path is one key per schedule if the cap ever rises meaningfully.
 */
const schedulesItem = defineItem<Schedule[]>("schedules", []);

/**
 * The bound on unattended work. A scheduled run's plan auto-approves, so the
 * agent holds a tool that creates more auto-approved future work — this is the
 * ceiling on how far that can go before the user is asked again.
 */
export const MAX_SCHEDULES = 20;

/** Consecutive self-reschedules before a self-paced loop has to stop and ask. */
export const MAX_CHAIN = 20;

/**
 * Every write is read-modify-write and fires can land while the settings page
 * is editing — serialize them on one chain, exactly as the conversation index
 * and the tip stats do.
 */
let writes: Promise<unknown> = Promise.resolve();
function serialized<T>(op: () => Promise<T>): Promise<T> {
  const next = writes.then(op, op);
  writes = next.catch(() => {});
  return next;
}

export function listSchedules(): Promise<Schedule[]> {
  return schedulesItem.get();
}

export function watchSchedules(cb: (list: Schedule[]) => void): () => void {
  return schedulesItem.watch(cb);
}

export async function getSchedule(id: string): Promise<Schedule | undefined> {
  return (await schedulesItem.get()).find((s) => s.id === id);
}

export type SaveResult = { ok: true; schedule: Schedule } | { ok: false; error: string };

/**
 * Stores a new schedule, or replaces one by id. The cap is enforced here rather
 * than at the call site so the tool, the settings page and any future caller
 * cannot each carry their own version of the limit.
 */
export function saveSchedule(schedule: Schedule): Promise<SaveResult> {
  return serialized(async () => {
    const list = await schedulesItem.get();
    const existing = list.findIndex((s) => s.id === schedule.id);
    if (existing < 0 && list.length >= MAX_SCHEDULES) {
      return { ok: false, error: i18n.t("schedule.errors.tooMany", { max: MAX_SCHEDULES }) };
    }
    const next = existing < 0 ? [...list, schedule] : list.with(existing, schedule);
    await schedulesItem.set(next);
    return { ok: true, schedule };
  });
}

/** Removes a schedule. False when it was already gone — the caller's cue not to lie about it. */
export function deleteSchedule(id: string): Promise<boolean> {
  return serialized(async () => {
    const list = await schedulesItem.get();
    const next = list.filter((s) => s.id !== id);
    if (next.length === list.length) return false;
    await schedulesItem.set(next);
    return true;
  });
}

/**
 * Moves a fired schedule to its next fire, or deletes it when the rule is spent
 * (a `once` that ran). Called the moment the run is submitted, not when it ends:
 * a worker killed mid-run must never leave a schedule pointing at a time that
 * has already passed, which would fire it again at the next boot.
 */
export function advanceSchedule(id: string, nextFireAt: number | null): Promise<void> {
  return serialized(async () => {
    const list = await schedulesItem.get();
    const i = list.findIndex((s) => s.id === id);
    const current = list[i];
    if (!current) return;
    await schedulesItem.set(
      nextFireAt === null
        ? list.filter((s) => s.id !== id)
        : list.with(i, { ...current, nextFireAt }),
    );
  });
}

/** Records how the last fire went — the settings row's "✓ 09:00" line. No-op
 *  for a one-shot, which advanceSchedule already retired. */
export function stampOutcome(id: string, at: number, ok: boolean): Promise<void> {
  return serialized(async () => {
    const list = await schedulesItem.get();
    const i = list.findIndex((s) => s.id === id);
    const current = list[i];
    if (!current) return;
    await schedulesItem.set(list.with(i, { ...current, lastRun: { at, ok } }));
  });
}
