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

  it("toggles the run target and notes it", () => {
    expect(executeSlash("/background")).toBe("executed");
    expect(useConversationStore.getState().runTarget).toBe("background");
    expect(lastNote()).toContain("background");
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
    // A unique no-arg fragment fires — there's nothing left to type.
    expect(executeSlash("/back")).toBe("executed");
    expect(useConversationStore.getState().runTarget).toBe("background");
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
  it("lists everything on a bare slash, filters by prefix, then swaps to candidates", () => {
    expect(slashItems("/")?.items).toHaveLength(COMMANDS.length);
    expect(slashItems("/mo")?.items.map((i) => i.key)).toEqual(["model"]);
    expect(slashItems("/model")?.items).toEqual([]); // exact name: completion done
    expect(slashItems("/effort ")?.items.map((i) => i.key)).toContain("high");
    expect(slashItems("/effort h")?.items.map((i) => i.key)).toEqual(["high"]);
    expect(slashItems("just text")).toBeNull();
  });
});
