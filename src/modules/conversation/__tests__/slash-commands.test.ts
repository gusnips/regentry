import { beforeEach, describe, expect, it } from "vitest";
import {
  COMMANDS,
  executeSlash,
  parseSlash,
  resolveSlashArg,
  slashItems,
} from "../ui/slash-commands";
import { useConversationStore } from "../ui/store";
import { useProvidersStore } from "@/modules/providers/ui";
import type { ProviderConfig } from "@/modules/providers/types";

const PROVIDER: ProviderConfig = {
  id: "p1",
  name: "Anthropic",
  shape: "anthropic",
  baseUrl: "https://api.anthropic.com",
  apiKey: "sk-test",
  createdAt: 0,
};

function command(name: string) {
  const found = COMMANDS.find((c) => c.name === name);
  if (!found) throw new Error(`no command ${name}`);
  return found;
}

function lastNote(): string {
  const messages = useConversationStore.getState().messages;
  const note = messages[messages.length - 1];
  expect(note?.role).toBe("step");
  expect(note?.tool).toBeUndefined();
  return note?.content ?? "";
}

beforeEach(() => {
  useProvidersStore.setState({ providers: [PROVIDER], activeId: "p1", loaded: true });
  useConversationStore.setState({ messages: [], runTarget: "thisPage", status: "idle" });
});

describe("parseSlash", () => {
  it("ignores plain text, prose after the slash, and multiline drafts", () => {
    expect(parseSlash("book the flight")).toBeNull();
    expect(parseSlash("/ prose, not a command")).toBeNull();
    expect(parseSlash("/model gpt-5\nsecond line")).toBeNull();
  });

  it("parses fragments, exact names, and args", () => {
    expect(parseSlash("/")).toEqual({ fragment: "" });
    expect(parseSlash("/mo")).toEqual({ fragment: "mo" });
    expect(parseSlash("/effort")).toEqual({ fragment: "effort", command: command("effort") });
    expect(parseSlash("/effort  Hi")).toEqual({
      fragment: "effort",
      command: command("effort"),
      arg: "Hi",
    });
  });
});

describe("resolveSlashArg", () => {
  it("keeps empty empty, matches exact and unique prefixes, passes the rest raw", () => {
    const effort = command("effort");
    expect(resolveSlashArg(effort, undefined)).toBeUndefined();
    expect(resolveSlashArg(effort, "")).toBeUndefined();
    expect(resolveSlashArg(effort, "HIGH")).toBe("high");
    expect(resolveSlashArg(effort, "h")).toBe("high");
    // No match passes through so the command answers with the options.
    expect(resolveSlashArg(effort, "turbo")).toBe("turbo");
    // Free-text args (a model id) have no candidates to resolve against.
    expect(resolveSlashArg(command("model"), "gpt-5")).toBe("gpt-5");
  });
});

describe("executeSlash", () => {
  it("leaves normal tasks alone", () => {
    expect(executeSlash("book the flight")).toBe("not-slash");
    expect(useConversationStore.getState().messages).toHaveLength(0);
  });

  it("reports the run target bare, and sets it explicitly by candidate", () => {
    expect(executeSlash("/background")).toBe("executed");
    expect(useConversationStore.getState().runTarget).toBe("thisPage"); // untouched
    expect(lastNote()).toContain("This page");
    expect(executeSlash("/background on")).toBe("executed");
    expect(useConversationStore.getState().runTarget).toBe("background");
    expect(lastNote()).toContain("background");
    expect(executeSlash("/background sideways")).toBe("executed");
    expect(useConversationStore.getState().runTarget).toBe("background"); // invalid changes nothing
    expect(lastNote()).toContain("sideways");
  });

  it("sets a valid effort and flags an invalid one — neither becomes a task", () => {
    expect(executeSlash("/effort high")).toBe("executed");
    expect(lastNote()).toContain("→ high");
    expect(executeSlash("/effort h")).toBe("executed");
    expect(lastNote()).toContain("→ high");
    expect(executeSlash("/effort turbo")).toBe("executed");
    expect(lastNote()).toContain("turbo");
    expect(lastNote()).toContain("none, low, medium, high, max");
  });

  it("reports the current model and effort when run bare", () => {
    executeSlash("/model");
    expect(lastNote()).toContain("Anthropic");
    executeSlash("/effort");
    expect(lastNote()).toContain("default");
  });

  it("answers an unknown command with the way forward", () => {
    expect(executeSlash("/frobnicate")).toBe("executed");
    expect(lastNote()).toContain("/frobnicate");
  });

  it("completes a unique arg-taking fragment instead of executing it", () => {
    expect(executeSlash("/eff")).toEqual({ complete: "/effort " });
    expect(executeSlash("/back")).toEqual({ complete: "/background " });
    // A unique no-arg fragment fires — there's nothing left to type.
    expect(executeSlash("/ne")).toBe("executed");
  });

  it("switches provider by name prefix", () => {
    useProvidersStore.setState({
      providers: [
        PROVIDER,
        { ...PROVIDER, id: "p2", name: "OpenAI", shape: "openai" as const },
      ],
    });
    executeSlash("/provider open");
    expect(lastNote()).toContain("→ OpenAI");
  });
});

describe("slashItems", () => {
  it("lists everything on a bare slash and filters by prefix", () => {
    expect(slashItems("/")?.items).toHaveLength(COMMANDS.length);
    expect(slashItems("/mo")?.items.map((i) => i.key)).toEqual(["model"]);
    expect(slashItems("just text")).toBeNull();
  });

  it("opens a bare picker's candidates with the current value marked", () => {
    const effort = slashItems("/effort");
    expect(effort?.kind).toBe("candidates");
    expect(effort?.items.map((i) => i.key)).toContain("high");
    // p1 has no persisted effort → "default" is the one checked.
    expect(effort?.items.find((i) => i.current)?.key).toBe("default");

    const model = slashItems("/model");
    expect(model?.items.map((i) => i.key)).toContain("auto");
    expect(model?.items.find((i) => i.current)?.key).toBe("auto");

    const background = slashItems("/background");
    expect(background?.items.map((i) => i.key)).toEqual(["off", "on"]);
    expect(background?.items.find((i) => i.current)?.key).toBe("off");
  });

  it("filters candidates by the typed arg", () => {
    expect(slashItems("/effort h")?.items.map((i) => i.key)).toEqual(["high"]);
    // A no-arg command's exact name shows nothing — Enter runs it.
    expect(slashItems("/new")?.items).toEqual([]);
  });
});
