import { describe, expect, it } from "vitest";
import { nextFireAt, recurrenceFromArgs, validateRecurrence } from "../recurrence";
import type { Recurrence } from "../types";

/** Local wall-clock helper — the tests are written in the zone vitest pins. */
const at = (y: number, m: number, d: number, h = 0, min = 0) =>
  new Date(y, m - 1, d, h, min, 0, 0).getTime();

const hourOf = (ms: number) => new Date(ms).getHours();
const dayOf = (ms: number) => new Date(ms).getDay();

describe("once", () => {
  it("fires at its time, then never again", () => {
    const rec: Recurrence = { kind: "once", at: at(2026, 8, 20, 15, 0) };
    expect(nextFireAt(rec, at(2026, 8, 20, 14, 0))).toBe(at(2026, 8, 20, 15, 0));
    // Spent: the scheduler reads null as "delete the record".
    expect(nextFireAt(rec, at(2026, 8, 20, 15, 0))).toBeNull();
    expect(nextFireAt(rec, at(2026, 8, 21, 0, 0))).toBeNull();
  });
});

describe("daily", () => {
  const nine: Recurrence = { kind: "daily", time: "09:00" };

  it("takes today when the hour is still ahead, tomorrow once it has passed", () => {
    expect(nextFireAt(nine, at(2026, 8, 20, 7, 30))).toBe(at(2026, 8, 20, 9, 0));
    expect(nextFireAt(nine, at(2026, 8, 20, 9, 30))).toBe(at(2026, 8, 21, 9, 0));
  });

  it("stays at 9am across a DST shift — the whole reason this is not an interval", () => {
    // Two US transitions: 2026-11-01 (clocks back) and 2027-03-14 (forward).
    // An implementation adding 24h in milliseconds drifts to 8am or 10am here.
    let cursor = at(2026, 10, 28, 12, 0);
    for (let i = 0; i < 200; i++) {
      const next = nextFireAt(nine, cursor);
      expect(next).not.toBeNull();
      expect(hourOf(next as number)).toBe(9);
      cursor = (next as number) + 60_000;
    }
  });

  it("skips to the next allowed weekday", () => {
    // 2026-08-21 is a Friday; weekdays-only lands on Monday the 24th.
    const weekdays: Recurrence = { kind: "daily", time: "09:00", days: [1, 2, 3, 4, 5] };
    expect(nextFireAt(weekdays, at(2026, 8, 21, 10, 0))).toBe(at(2026, 8, 24, 9, 0));
  });

  it("is unsatisfiable with an empty day list rather than looping forever", () => {
    expect(nextFireAt({ kind: "daily", time: "09:00", days: [] }, at(2026, 8, 20))).toBeNull();
    expect(nextFireAt({ kind: "daily", time: "nope" }, at(2026, 8, 20))).toBeNull();
  });
});

describe("interval", () => {
  it("steps by its period when no window bounds it", () => {
    const hourly: Recurrence = { kind: "interval", everyMinutes: 60 };
    expect(nextFireAt(hourly, at(2026, 8, 20, 14, 0))).toBe(at(2026, 8, 20, 15, 0));
  });

  it("clamps into the window: before it opens, jump to the opening", () => {
    const rec: Recurrence = { kind: "interval", everyMinutes: 60, from: "09:00", to: "17:00" };
    expect(nextFireAt(rec, at(2026, 8, 20, 6, 0))).toBe(at(2026, 8, 20, 9, 0));
  });

  it("clamps into the window: past its close, jump to tomorrow's opening", () => {
    const rec: Recurrence = { kind: "interval", everyMinutes: 60, from: "09:00", to: "17:00" };
    // 16:40 + 60m = 17:40, past the close — the next fire is tomorrow at 09:00.
    expect(nextFireAt(rec, at(2026, 8, 20, 16, 40))).toBe(at(2026, 8, 21, 9, 0));
  });

  it("stays inside the window all day long", () => {
    const rec: Recurrence = { kind: "interval", everyMinutes: 60, from: "09:00", to: "17:00" };
    let cursor = at(2026, 8, 20, 8, 0);
    for (let i = 0; i < 50; i++) {
      const next = nextFireAt(rec, cursor) as number;
      expect(hourOf(next)).toBeGreaterThanOrEqual(9);
      expect(hourOf(next)).toBeLessThanOrEqual(17);
      cursor = next;
    }
  });

  it("honours a weekday filter alongside the window", () => {
    const rec: Recurrence = {
      kind: "interval",
      everyMinutes: 120,
      from: "09:00",
      to: "17:00",
      days: [1, 2, 3, 4, 5],
    };
    // Friday 16:30 → +2h is past the close, and the weekend is excluded.
    expect(nextFireAt(rec, at(2026, 8, 21, 16, 30))).toBe(at(2026, 8, 24, 9, 0));
    let cursor = at(2026, 8, 20, 9, 0);
    for (let i = 0; i < 40; i++) {
      const next = nextFireAt(rec, cursor) as number;
      expect(dayOf(next)).toBeGreaterThanOrEqual(1);
      expect(dayOf(next)).toBeLessThanOrEqual(5);
      cursor = next;
    }
  });
});

describe("validateRecurrence", () => {
  const now = at(2026, 8, 20, 12, 0);
  const ok = (rec: Recurrence) => expect(validateRecurrence(rec, now)).toBeUndefined();
  const rejects = (rec: Recurrence) => expect(validateRecurrence(rec, now)).toBeTruthy();

  it("accepts the shapes the agent is told to send", () => {
    ok({ kind: "once", at: at(2026, 8, 20, 15, 0) });
    ok({ kind: "daily", time: "09:00", days: [1, 2, 3, 4, 5] });
    ok({ kind: "interval", everyMinutes: 60, from: "09:00", to: "17:00" });
  });

  it("refuses what would misfire, silently or forever", () => {
    rejects({ kind: "once", at: at(2026, 8, 20, 11, 0) }); // already past
    rejects({ kind: "daily", time: "25:00" });
    rejects({ kind: "daily", time: "09:00", days: [] });
    rejects({ kind: "interval", everyMinutes: 1 }); // under the alarm floor
    rejects({ kind: "interval", everyMinutes: 60, from: "17:00", to: "09:00" }); // inverted
  });
});

describe("recurrenceFromArgs", () => {
  it("reads what a model actually sends", () => {
    expect(recurrenceFromArgs({ kind: "once", at: "2026-08-20T15:00" })).toEqual({
      kind: "once",
      at: at(2026, 8, 20, 15, 0),
    });
    expect(recurrenceFromArgs({ kind: "daily", time: "09:00", days: [1, 5] })).toEqual({
      kind: "daily",
      time: "09:00",
      days: [1, 5],
    });
    // snake_case is what the tool schema advertises; camelCase is the slip.
    expect(recurrenceFromArgs({ kind: "interval", every_minutes: 30 })).toEqual({
      kind: "interval",
      everyMinutes: 30,
    });
    expect(recurrenceFromArgs({ kind: "interval", everyMinutes: 30 })).toEqual({
      kind: "interval",
      everyMinutes: 30,
    });
  });

  it("returns undefined rather than a half-built rule", () => {
    expect(recurrenceFromArgs(null)).toBeUndefined();
    expect(recurrenceFromArgs({ kind: "weekly" })).toBeUndefined();
    expect(recurrenceFromArgs({ kind: "once", at: "not a date" })).toBeUndefined();
    expect(recurrenceFromArgs({ kind: "daily" })).toBeUndefined();
    expect(recurrenceFromArgs({ kind: "interval" })).toBeUndefined();
  });
});
