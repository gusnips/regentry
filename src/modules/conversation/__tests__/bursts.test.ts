import { describe, it, expect } from "vitest";
import { groupBursts } from "../ui/bursts";
import type { Message, MessageRole } from "../types";

let seq = 0;
const msg = (role: MessageRole, timestamp: number, extra: Partial<Message> = {}): Message => ({
  id: `${role}-${seq++}`,
  role,
  content: "",
  timestamp,
  ...extra,
});

describe("groupBursts", () => {
  it("folds an alternating thought/step run into one burst", () => {
    const items = groupBursts([
      msg("reasoning", 1000, { elapsed: 500 }),
      msg("step", 1100, { tool: "click" }),
      msg("reasoning", 1300, { elapsed: 200 }),
      msg("step", 1400, { tool: "type" }),
      msg("assistant", 2000),
    ]);
    expect(items).toHaveLength(2);
    const [burst] = items;
    if (!burst || burst.kind !== "burst") throw new Error("expected burst");
    expect(burst.steps).toHaveLength(2);
    // The first thought's timestamp marks its end — the burst starts earlier.
    expect(burst.startedAt).toBe(500);
    // The assistant message that ends the run bounds its wall time.
    expect(burst.endedAt).toBe(2000);
    expect(burst.live).toBe(false);
  });

  it("keeps thought-only and step-only runs flat", () => {
    const thoughts = groupBursts([msg("reasoning", 1000, { elapsed: 500 })]);
    const steps = groupBursts([
      msg("step", 1100, { tool: "click" }),
      msg("step", 1200, { tool: "type" }),
    ]);
    expect([...thoughts, ...steps].every((i) => i.kind === "message")).toBe(true);
    expect(thoughts).toHaveLength(1);
    expect(steps).toHaveLength(2);
  });

  it("splits bursts on plans and other messages", () => {
    const items = groupBursts([
      msg("reasoning", 1000, { elapsed: 100 }),
      msg("step", 1100, { tool: "click" }),
      msg("plan", 1200),
      msg("reasoning", 1300, { elapsed: 100 }),
      msg("step", 1400, { tool: "type" }),
    ]);
    const bursts = items.filter((i) => i.kind === "burst");
    expect(bursts).toHaveLength(2);
    expect(items[1]).toMatchObject({ kind: "message", msg: { role: "plan" } });
  });

  it("marks a burst live while any step is in flight", () => {
    const items = groupBursts([
      msg("reasoning", 1000, { elapsed: 100 }),
      msg("step", 1100, { tool: "click", live: true }),
    ]);
    const [burst] = items;
    if (!burst || burst.kind !== "burst") throw new Error("expected burst");
    expect(burst.live).toBe(true);
    expect(burst.endedAt).toBeUndefined();
  });
});
