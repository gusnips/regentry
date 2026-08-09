/**
 * The tip list, as data. Each id is a key under the `tips` object in the i18n
 * catalogs — the copy lives there, this file owns identity and cadence.
 * `cooldownOpens` is measured in panel opens (Claude Code measures in app
 * startups; our "session" is a panel open), so the short-cooldown tips are the
 * core shortcuts worth repeating and the long ones are the niche features.
 */
export const TIPS = [
  { id: "escStop", cooldownOpens: 4 },
  { id: "historyRecall", cooldownOpens: 4 },
  { id: "thisPage", cooldownOpens: 4 },
  { id: "queueSteer", cooldownOpens: 4 },
  { id: "pasteImage", cooldownOpens: 6 },
  { id: "pasteCollapse", cooldownOpens: 6 },
  { id: "planApproval", cooldownOpens: 6 },
  { id: "planExpand", cooldownOpens: 4 },
  { id: "widget", cooldownOpens: 6 },
  { id: "board", cooldownOpens: 6 },
  { id: "memory", cooldownOpens: 8 },
  { id: "usage", cooldownOpens: 8 },
] as const;

export type TipId = (typeof TIPS)[number]["id"];
