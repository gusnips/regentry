import { i18n } from "@/i18n";
import { providerDisplayName } from "@/modules/providers/presets";
import { EFFORT_LABEL_KEYS, isEffort, REASONING_EFFORTS } from "@/modules/providers/types";
import { useProvidersStore } from "@/modules/providers/ui";
import { useConversationStore } from "./store";

/**
 * Slash commands — /background, /effort, /model, /provider, /new, /help.
 * A draft whose first character is "/" (and that stays on one line) is a
 * command, not a task: it runs LOCALLY against the panel's stores and is never
 * sent to the model, never written to the transcript (the transcript is the
 * model's memory — a settings echo would pose as a turn). Each result lands as
 * a display-only note row (a tool-less step message), gone on panel reopen.
 *
 * The escape hatch for a task that must start with "/": any newline, or a
 * space right after the slash, makes it prose again.
 */

export interface SlashCandidate {
  /** What the command receives when this candidate wins. */
  value: string;
  /** What the menu shows; matching tries it too, so a localized label completes. */
  label: string;
}

type CommandDescriptionKey =
  | "commands.background.description"
  | "commands.effort.description"
  | "commands.model.description"
  | "commands.provider.description"
  | "commands.new.description"
  | "commands.help.description";

export interface SlashCommand {
  name: string;
  descriptionKey: CommandDescriptionKey;
  /** Takes an optional argument — running it bare reports the current value. */
  takesArg?: boolean;
  /** A closed arg set (effort levels, configured providers) — powers menu
   *  completion. Absent with takesArg: free text (a model id). */
  candidates?: () => SlashCandidate[];
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
}

/** The command's own say — a quiet line in the transcript, gone on reopen. */
function note(content: string): void {
  useConversationStore.getState().note(content);
}

/** The provider the header chips call active — the stored pick, else the first. */
function activeProvider() {
  const { providers, activeId } = useProvidersStore.getState();
  return providers.find((p) => p.id === activeId) ?? providers[0];
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

export const COMMANDS: readonly SlashCommand[] = [
  {
    name: "background",
    descriptionKey: "commands.background.description",
    run: () => {
      const store = useConversationStore.getState();
      const next = store.runTarget === "thisPage" ? "background" : "thisPage";
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
 * typed, arg candidates after the space. An exact name with no space yet shows
 * nothing — completion is done, Enter runs it.
 */
export function slashItems(text: string): { parsed: ParsedSlash; items: SlashItem[] } | null {
  const parsed = parseSlash(text);
  if (!parsed) return null;
  if (parsed.command && parsed.arg !== undefined) {
    const candidates = parsed.command.candidates?.() ?? [];
    const q = parsed.arg.toLowerCase();
    return {
      parsed,
      items: candidates
        .filter(
          (c) =>
            !q || c.value.toLowerCase().startsWith(q) || c.label.toLowerCase().startsWith(q),
        )
        .map((c) => ({ key: c.value, primary: c.label })),
    };
  }
  if (parsed.command) return { parsed, items: [] };
  return {
    parsed,
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
  const exact = candidates.find(
    (c) => c.value.toLowerCase() === q || c.label.toLowerCase() === q,
  );
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
