import { i18n } from "@/i18n";
import { knownModels, pickLatestModel } from "@/modules/providers/models";
import { providerDisplayName } from "@/modules/providers/presets";
import { formatResetRelative } from "@/modules/providers/rate-limit";
import { EFFORT_LABEL_KEYS, isEffort, REASONING_EFFORTS } from "@/modules/providers/types";
import { fetchProviderUsage, supportsUsage } from "@/modules/providers/usage";
import type { UsageWindow } from "@/modules/providers/usage";
import { useProvidersStore, activeProviderOf } from "@/modules/providers/ui";
import { useConversationStore } from "./store";

/**
 * Slash commands — /background, /effort, /model, /provider, /new, /help.
 * A draft whose first character is "/" (and that stays on one line) is a
 * command, not a task: it runs LOCALLY against the panel's stores and is never
 * sent to the model, never written to the transcript (the transcript is the
 * model's memory — a settings echo would pose as a turn). Each result lands as
 * a display-only note row (a tool-less step message), gone on panel reopen.
 *
 * A bare picker command (/effort, /model, /provider, /background) opens its
 * candidates in the menu with the current value checked and pre-highlighted —
 * arrows + Enter pick, like the header selects. The escape hatch for a task
 * that must start with "/": any newline, or a space right after the slash,
 * makes it prose again.
 */

export interface SlashCandidate {
  /** What the command receives when this candidate wins. */
  value: string;
  /** What the menu shows; matching tries it too, so a localized label completes. */
  label: string;
  /** A quiet second column (e.g. the model "auto" actually resolves to). */
  secondary?: string;
}

type CommandDescriptionKey =
  | "commands.background.description"
  | "commands.effort.description"
  | "commands.model.description"
  | "commands.provider.description"
  | "commands.usage.description"
  | "commands.compact.description"
  | "commands.new.description"
  | "commands.help.description";

export interface SlashCommand {
  name: string;
  descriptionKey: CommandDescriptionKey;
  /** Takes an optional argument — running it bare reports the current value. */
  takesArg?: boolean;
  /** A closed arg set (effort levels, configured providers) — powers the picker menu. */
  candidates?: () => SlashCandidate[];
  /** The candidate value in effect right now — the menu checks it and lands
   *  the highlight on it, so Enter on an untouched picker is a harmless no-op. */
  current?: () => string | undefined;
  run: (arg: string | undefined) => void;
}

export interface ParsedSlash {
  /** Name fragment being typed (lowercased) — the menu's filter. */
  fragment: string;
  /** Set only on an exact command-name match. */
  command?: SlashCommand;
  /** Text after "/name ", trimmed — undefined while the name is still being typed. */
  arg?: string;
}

export interface SlashItem {
  key: string;
  primary: string;
  secondary?: string;
  /** The value in effect — the menu checks it and lands the highlight on it. */
  current?: boolean;
}

/** What the menu shows for a draft: command matches while the name is being
 *  typed, the command's candidates once the name is exact. */
export type SlashMenuState =
  | { kind: "commands"; items: SlashItem[] }
  | { kind: "candidates"; command: SlashCommand; items: SlashItem[] };

/** The command's own say — a quiet line in the transcript, gone on reopen. */
function note(content: string): void {
  useConversationStore.getState().note(content);
}

/** The provider the header chips call active — one shared rule, see activeProviderOf. */
function activeProvider() {
  return activeProviderOf(useProvidersStore.getState());
}

/** Settings edits land on the stored config that the next run snapshots — a
 *  bare "Model → X" while a run is live would read as if it applied mid-run. */
function nextTaskSuffix(): string {
  return useConversationStore.getState().status === "running"
    ? ` ${i18n.t("commands.nextTask")}`
    : "";
}

/** The effort picker's full set, as typable tokens — never translated. */
const EFFORT_OPTIONS = ["default", ...REASONING_EFFORTS].join(", ");

/** One usage window as a line: "5-hour window: 42% used · resets in 1h 12m". */
function windowLine(label: string, window: UsageWindow): string {
  const used = i18n.t("usage.usedPercent", { percent: window.usedPercent });
  return window.resetsAtMs === undefined
    ? `${label}: ${used}`
    : `${label}: ${used} · ${i18n.t("usage.resets", { reset: formatResetRelative(window.resetsAtMs, Date.now()) })}`;
}

export const COMMANDS: readonly SlashCommand[] = [
  {
    name: "background",
    descriptionKey: "commands.background.description",
    takesArg: true,
    candidates: () => [
      { value: "off", label: i18n.t("run.thisPage") },
      { value: "on", label: i18n.t("run.background") },
    ],
    current: () => (useConversationStore.getState().runTarget === "background" ? "on" : "off"),
    run: (arg) => {
      const store = useConversationStore.getState();
      if (!arg) {
        note(
          i18n.t("commands.background.current", {
            target: i18n.t(store.runTarget === "thisPage" ? "run.thisPage" : "run.background"),
          }),
        );
        return;
      }
      if (arg !== "on" && arg !== "off") {
        note(i18n.t("commands.background.invalid", { value: arg }));
        return;
      }
      const next = arg === "on" ? "background" : "thisPage";
      store.setRunTarget(next);
      note(
        i18n.t(
          next === "background"
            ? "commands.background.nowBackground"
            : "commands.background.nowThisPage",
        ),
      );
    },
  },
  {
    name: "effort",
    descriptionKey: "commands.effort.description",
    takesArg: true,
    candidates: () => [
      { value: "default", label: i18n.t("modelPicker.effort.default") },
      ...REASONING_EFFORTS.map((value) => ({ value, label: i18n.t(EFFORT_LABEL_KEYS[value]) })),
    ],
    current: () => activeProvider()?.reasoningEffort ?? "default",
    run: (arg) => {
      const provider = activeProvider();
      // Unreachable — the panel onboards instead of showing a composer when
      // no provider exists — but a note-less crash is worse than a guard.
      if (!provider) return;
      const name = providerDisplayName(provider);
      if (!arg) {
        note(
          i18n.t("commands.effort.current", {
            effort: provider.reasoningEffort ?? "default",
            provider: name,
          }) + nextTaskSuffix(),
        );
        return;
      }
      const level = arg.toLowerCase();
      if (level !== "default" && !isEffort(level)) {
        note(i18n.t("commands.effort.invalid", { value: arg, options: EFFORT_OPTIONS }));
        return;
      }
      void useProvidersStore
        .getState()
        .update(provider.id, { reasoningEffort: level === "default" ? undefined : level });
      note(i18n.t("commands.effort.set", { effort: level, provider: name }) + nextTaskSuffix());
    },
  },
  {
    name: "model",
    descriptionKey: "commands.model.description",
    takesArg: true,
    // The same list the header picker shows — this session's live listing when
    // one landed, else the preset's — with "auto" naming what it resolves to.
    candidates: () => {
      const provider = activeProvider();
      if (!provider) return [];
      const listed = knownModels(provider);
      const autoTarget = pickLatestModel(listed) ?? listed[0];
      return [
        {
          value: "auto",
          label: i18n.t("modelPicker.auto"),
          ...(autoTarget ? { secondary: autoTarget.name ?? autoTarget.id } : {}),
        },
        ...listed.map((m) => ({ value: m.id, label: m.name ?? m.id })),
      ];
    },
    current: () => activeProvider()?.model ?? "auto",
    run: (arg) => {
      const provider = activeProvider();
      if (!provider) return;
      const name = providerDisplayName(provider);
      if (!arg) {
        note(
          i18n.t("commands.model.current", {
            model: provider.model ?? i18n.t("modelPicker.auto"),
            provider: name,
          }) + nextTaskSuffix(),
        );
        return;
      }
      if (arg.toLowerCase() === "auto") {
        void useProvidersStore.getState().update(provider.id, { model: undefined });
        note(i18n.t("commands.model.auto", { provider: name }) + nextTaskSuffix());
        return;
      }
      // Any string goes — the header picker already keeps a pinned id the
      // endpoint stops listing, so the slash command is equally permissive.
      void useProvidersStore.getState().update(provider.id, { model: arg });
      note(i18n.t("commands.model.set", { model: arg, provider: name }) + nextTaskSuffix());
    },
  },
  {
    name: "provider",
    descriptionKey: "commands.provider.description",
    takesArg: true,
    candidates: () =>
      useProvidersStore
        .getState()
        .providers.map((p) => ({ value: p.id, label: providerDisplayName(p) })),
    current: () => activeProvider()?.id,
    run: (arg) => {
      const { providers } = useProvidersStore.getState();
      const current = activeProvider();
      if (!current) return;
      if (!arg) {
        const others = providers
          .filter((p) => p.id !== current.id)
          .map((p) => providerDisplayName(p));
        note(
          others.length > 0
            ? i18n.t("commands.provider.current", {
                name: providerDisplayName(current),
                others: new Intl.ListFormat(i18n.language, { type: "conjunction" }).format(others),
              })
            : i18n.t("commands.provider.currentOnly", { name: providerDisplayName(current) }),
        );
        return;
      }
      const q = arg.toLowerCase();
      const matches = (p: (typeof providers)[number], test: (s: string) => boolean) =>
        test(p.id.toLowerCase()) || test(providerDisplayName(p).toLowerCase());
      const pick =
        providers.find((p) => matches(p, (s) => s === q)) ??
        (() => {
          const prefix = providers.filter((p) => matches(p, (s) => s.startsWith(q)));
          return prefix.length === 1 ? prefix[0] : undefined;
        })();
      if (!pick) {
        note(
          i18n.t("commands.provider.unknown", {
            value: arg,
            list: providers.map((p) => providerDisplayName(p)).join(", "),
          }),
        );
        return;
      }
      void useProvidersStore.getState().activate(pick.id);
      note(i18n.t("commands.provider.set", { name: providerDisplayName(pick) }) + nextTaskSuffix());
    },
  },
  {
    name: "usage",
    descriptionKey: "commands.usage.description",
    run: () => {
      const provider = activeProvider();
      if (!provider) return;
      if (!supportsUsage(provider.id)) {
        note(i18n.t("commands.usage.unsupported", { provider: providerDisplayName(provider) }));
        return;
      }
      // A typed /usage is a deliberate ask and wants fresh numbers — the header
      // gauge's TTL cache exists for its remount churn, not for this.
      void fetchProviderUsage(provider).then(
        (usage) => {
          const name = providerDisplayName(provider) + (usage.plan ? ` (${usage.plan})` : "");
          const windows: string[] = [];
          if (usage.fiveHour) windows.push(windowLine(i18n.t("usage.window5h"), usage.fiveHour));
          if (usage.weekly) windows.push(windowLine(i18n.t("usage.windowWeekly"), usage.weekly));
          note([name, ...(windows.length > 0 ? windows : [i18n.t("usage.empty")])].join("\n"));
        },
        // fetchProviderUsage's message is already classified — auth failures
        // arrive worded as the sign-in fix.
        (e: unknown) => note(e instanceof Error ? e.message : String(e)),
      );
    },
  },
  {
    name: "compact",
    descriptionKey: "commands.compact.description",
    // The one command that is not local: summarizing takes a model call, and
    // the transcript it writes to is the worker's. The store's action posts it
    // and reports back through the compacted/compact_failed events.
    run: () => {
      useConversationStore.getState().compact();
    },
  },
  {
    name: "new",
    descriptionKey: "commands.new.description",
    run: () => {
      // No note — the fresh chat's empty state is the acknowledgment.
      useConversationStore.getState().newConversation();
    },
  },
  {
    name: "help",
    descriptionKey: "commands.help.description",
    run: () => {
      note(COMMANDS.map((c) => `/${c.name} — ${i18n.t(c.descriptionKey)}`).join("\n"));
    },
  },
];

export function parseSlash(text: string): ParsedSlash | null {
  if (!text.startsWith("/") || text.includes("\n")) return null;
  const body = text.slice(1);
  if (/^\s/.test(body)) return null;
  const space = body.search(/\s/);
  const fragment = (space === -1 ? body : body.slice(0, space)).toLowerCase();
  const command = COMMANDS.find((c) => c.name === fragment);
  return {
    fragment,
    ...(command ? { command } : {}),
    ...(space === -1 ? {} : { arg: body.slice(space + 1).trim() }),
  };
}

/**
 * What the menu shows for a draft: command matches while the name is being
 * typed; the command's candidates once the name is exact — a bare "/effort"
 * opens the picker straight away, no trailing space needed. An exact name with
 * no candidates (or none matching the typed arg) shows nothing — Enter runs it.
 */
export function slashItems(text: string): SlashMenuState | null {
  const parsed = parseSlash(text);
  if (!parsed) return null;
  if (parsed.command) {
    const command = parsed.command;
    const current = command.current?.();
    const q = (parsed.arg ?? "").toLowerCase();
    const items = (command.candidates?.() ?? [])
      .filter(
        (c) => !q || c.value.toLowerCase().startsWith(q) || c.label.toLowerCase().startsWith(q),
      )
      .map((c) => ({
        key: c.value,
        primary: c.label,
        ...(c.secondary ? { secondary: c.secondary } : {}),
        ...(c.value === current ? { current: true } : {}),
      }));
    return { kind: "candidates", command, items };
  }
  return {
    kind: "commands",
    items: COMMANDS.filter((c) => c.name.startsWith(parsed.fragment)).map((c) => ({
      key: c.name,
      primary: `/${c.name}`,
      secondary: i18n.t(c.descriptionKey),
    })),
  };
}

/**
 * The typed arg → what the command receives. Empty stays empty (the report
 * form); a candidate wins on an exact or unique-prefix match against either
 * its value or its label; anything else passes through raw so the command's
 * own validation can answer with the options.
 */
export function resolveSlashArg(
  command: SlashCommand,
  raw: string | undefined,
): string | undefined {
  if (raw === undefined || raw === "") return undefined;
  const candidates = command.candidates?.() ?? [];
  if (candidates.length === 0) return raw;
  const q = raw.toLowerCase();
  const exact = candidates.find((c) => c.value.toLowerCase() === q || c.label.toLowerCase() === q);
  if (exact) return exact.value;
  const prefix = candidates.filter(
    (c) => c.value.toLowerCase().startsWith(q) || c.label.toLowerCase().startsWith(q),
  );
  return prefix.length === 1 && prefix[0] ? prefix[0].value : raw;
}

export type SlashOutcome = "not-slash" | "executed" | { complete: string };

/**
 * Enter on a slash draft. An exact command runs (its arg resolved); a unique
 * arg-taking fragment completes into the draft instead of executing, so
 * "/mo" Enter never fires a half-typed "/model gpt-5". Anything else is an
 * unknown command — answered with a note, never sent as a task.
 */
export function executeSlash(text: string): SlashOutcome {
  const parsed = parseSlash(text);
  if (!parsed) return "not-slash";
  if (parsed.command) {
    parsed.command.run(resolveSlashArg(parsed.command, parsed.arg));
    return "executed";
  }
  if (!parsed.fragment) return "executed"; // a bare "/" — the menu already said everything
  const matches = COMMANDS.filter((c) => c.name.startsWith(parsed.fragment));
  if (matches.length === 1 && matches[0]) {
    const command = matches[0];
    if (command.takesArg) return { complete: `/${command.name} ` };
    command.run(undefined);
    return "executed";
  }
  note(i18n.t("commands.unknown", { name: parsed.fragment }));
  return "executed";
}
