import { describe, it, expect, vi, afterEach } from "vitest";
import {
  buildExtractionSystemPrompt,
  buildExtractionMessages,
  parseExtractedFacts,
  extractAndRemember,
} from "../extract";
import { getDoc, setDoc, memoryEnabled, DURABLE_FACT_RULES } from "../documents";
import type { ChatMessage, ResolvedProviderConfig } from "@/modules/providers/types";

// Storage stand-in and i18n come from src/test-setup.ts (vitest setupFiles).

/** OpenAI-shape config: the extraction turn's provider is rebuilt from this by createProvider. */
function makeConfig(): ResolvedProviderConfig {
  return {
    id: "test",
    name: "Test",
    shape: "openai",
    baseUrl: "https://api.example.com/v1",
    apiKey: "sk-test",
    model: "test-model",
    createdAt: 0,
  };
}

function sseText(lines: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const line of lines) controller.enqueue(encoder.encode(line + "\n"));
      controller.close();
    },
  });
}

/** Make the extraction turn's stream reply with the given text delta(s). */
function mockStreamReply(text: string) {
  vi.spyOn(globalThis, "fetch").mockResolvedValue(
    new Response(
      sseText([
        `data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}`,
        "data: [DONE]",
      ]),
      { status: 200, headers: { "content-type": "text/event-stream" } },
    ),
  );
}

describe("buildExtractionSystemPrompt", () => {
  it("carries the shared admission rules — this is the path that auto-saves", () => {
    const prompt = buildExtractionSystemPrompt("");
    expect(prompt).toContain(DURABLE_FACT_RULES);
    // The counterweight to "here is a transcript, give me a list".
    expect(prompt).toMatch(/most runs teach nothing durable/i);
  });

  it("shows the current memory so the model does not re-save it", () => {
    const prompt = buildExtractionSystemPrompt("- The user's handle is gus.");
    expect(prompt).toContain("- The user's handle is gus.");
    expect(prompt).toContain("none");
  });

  it("marks an empty memory", () => {
    expect(buildExtractionSystemPrompt("")).toContain("(empty)");
  });
});

describe("buildExtractionMessages", () => {
  const transcript: ChatMessage[] = [
    { role: "system", content: "You are a browser agent." },
    { role: "user", content: "Do the thing", images: ["data:image/jpeg;base64,AAAA"] },
    {
      role: "assistant",
      content: "",
      reasoning: "should not ride along",
      toolCalls: [{ id: "c1", name: "navigate", args: { url: "https://example.com" } }],
    },
    {
      role: "tool_results",
      content: "",
      toolResults: [{ id: "c1", content: "Page loaded", images: ["data:image/jpeg;base64,BBBB"] }],
    },
  ];

  it("prepends the extraction system prompt and drops the run's own system message", () => {
    const messages = buildExtractionMessages(transcript, "- known fact");
    expect(messages[0]).toEqual({
      role: "system",
      content: buildExtractionSystemPrompt("- known fact"),
    });
    expect(messages.filter((m) => m.role === "system")).toHaveLength(1);
  });

  it("keeps the run's turns, stripped of everything the extraction call cannot use", () => {
    const messages = buildExtractionMessages(transcript, "");
    expect(messages).toHaveLength(5); // system + the three non-system turns + the closing ask

    expect(messages[1]).toEqual({ role: "user", content: "Do the thing" });
    expect(messages[1]?.images).toBeUndefined();

    // Tool calls stay — the model needs to see what the run did — but reasoning
    // and any images on the tool result are stripped.
    expect(messages[2]?.toolCalls?.[0]).toEqual({
      id: "c1",
      name: "navigate",
      args: { url: "https://example.com" },
    });
    expect(messages[2]?.reasoning).toBeUndefined();

    expect(messages[3]?.toolResults).toEqual([{ id: "c1", content: "Page loaded" }]);
    expect(messages[3]?.toolResults?.[0]?.images).toBeUndefined();
  });

  it("drops tool calls that never got a result — an unmatched done/ask_user 400s the wire", () => {
    const ended: ChatMessage[] = [
      { role: "user", content: "Task" },
      {
        role: "assistant",
        content: "",
        toolCalls: [
          { id: "c1", name: "snapshot", args: {} },
          { id: "c2", name: "done", args: { summary: "finished" } },
        ],
      },
      { role: "tool_results", content: "", toolResults: [{ id: "c1", content: "Page" }] },
    ];
    const messages = buildExtractionMessages(ended, "");
    // The answered call stays; the terminal done call does not.
    expect(messages[2]?.toolCalls?.map((c) => c.name)).toEqual(["snapshot"]);
    expect(messages[3]?.role).toBe("tool_results");
  });

  it("drops an assistant turn left empty once its unanswered call is filtered", () => {
    const ended: ChatMessage[] = [
      { role: "user", content: "Task" },
      { role: "assistant", content: "", toolCalls: [{ id: "c9", name: "done", args: {} }] },
    ];
    const messages = buildExtractionMessages(ended, "");
    expect(messages).toHaveLength(3); // system + user + the closing ask — no empty assistant message
  });

  it("closes on a user turn — a trailing assistant message is an Anthropic prefill 400", () => {
    // The common run end: the model speaks its summary alongside the done call.
    const ended: ChatMessage[] = [
      { role: "user", content: "Task" },
      {
        role: "assistant",
        content: "All done — the renewal went through.",
        toolCalls: [{ id: "c9", name: "done", args: { summary: "renewed" } }],
      },
    ];
    const messages = buildExtractionMessages(ended, "");
    // The summary survives the done-call filter — it is the gist extraction wants…
    expect(messages.at(-2)).toEqual({
      role: "assistant",
      content: "All done — the renewal went through.",
      toolCalls: undefined,
      toolResults: undefined,
    });
    // …but it may not close the wire.
    expect(messages.at(-1)?.role).toBe("user");
    expect(messages.at(-1)?.content).toContain("none");
  });

  it("caps oversized texts — the extraction call needs the gist, not the pages", () => {
    const huge = "x".repeat(10_000);
    const messages = buildExtractionMessages(
      [
        { role: "user", content: huge },
        {
          role: "tool_results",
          content: "",
          toolResults: [{ id: "c1", content: huge }],
        },
      ],
      "",
    );
    expect(messages[1]?.content.length).toBeLessThan(huge.length);
    expect(messages[1]?.content.endsWith("…")).toBe(true);
    expect(messages[2]?.toolResults?.[0]?.content.length).toBeLessThan(huge.length);
  });
});

describe("parseExtractedFacts", () => {
  it("collects list lines, stripping the marker", () => {
    expect(parseExtractedFacts("- one\n- two\n- three")).toEqual(["one", "two", "three"]);
  });

  it("accepts * markers and leading whitespace", () => {
    expect(parseExtractedFacts("  * fact")).toEqual(["fact"]);
  });

  it("returns nothing for a bare 'none', whatever the casing or punctuation", () => {
    expect(parseExtractedFacts("none")).toEqual([]);
    expect(parseExtractedFacts("None.")).toEqual([]);
    expect(parseExtractedFacts("  NONE  ")).toEqual([]);
  });

  it("ignores prose — a fact must be a list line to count", () => {
    expect(parseExtractedFacts("The run taught nothing durable.\n- but this one counts")).toEqual([
      "but this one counts",
    ]);
  });

  it("caps at the per-run ceiling", () => {
    expect(parseExtractedFacts("- a\n- b\n- c\n- d\n- e")).toEqual(["a", "b", "c"]);
  });
});

describe("extractAndRemember", () => {
  afterEach(() => vi.restoreAllMocks());

  it("writes the facts the extraction turn names", async () => {
    mockStreamReply(
      "- The user's work account is me@acme.com.\n- Login on billing is the email link.",
    );
    await extractAndRemember(makeConfig(), [], new AbortController().signal);
    expect(await getDoc("MEMORY.md")).toBe(
      "- The user's work account is me@acme.com.\n- Login on billing is the email link.\n",
    );
  });

  it("writes nothing when the extraction turn finds nothing durable", async () => {
    mockStreamReply("none");
    await extractAndRemember(makeConfig(), [], new AbortController().signal);
    expect(await getDoc("MEMORY.md")).toBe("");
  });

  it("does not fetch or write when memory is off", async () => {
    await memoryEnabled.set(false);
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    await extractAndRemember(makeConfig(), [], new AbortController().signal);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(await getDoc("MEMORY.md")).toBe("");
  });

  it("never throws — a failing extraction is a background nicety, not a run failure", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new TypeError("boom"));
    await expect(
      extractAndRemember(
        makeConfig(),
        [{ role: "user", content: "task" }],
        new AbortController().signal,
      ),
    ).resolves.toBeUndefined();
    expect(await getDoc("MEMORY.md")).toBe("");
  });

  it("dedups against existing memory via remember()", async () => {
    await setDoc("MEMORY.md", "- A known fact.\n");
    mockStreamReply("- A known fact.\n- A fresh one.");
    await extractAndRemember(makeConfig(), [], new AbortController().signal);
    expect(await getDoc("MEMORY.md")).toBe("- A known fact.\n- A fresh one.\n");
  });

  it("extracts from a run that ended on done — the terminal call never got a result", async () => {
    mockStreamReply("- The user's handle is gus.");
    await extractAndRemember(
      makeConfig(),
      [
        { role: "system", content: "You are a browser agent." },
        { role: "user", content: "Check my handle" },
        { role: "assistant", content: "", toolCalls: [{ id: "c1", name: "done", args: {} }] },
      ],
      new AbortController().signal,
    );
    expect(await getDoc("MEMORY.md")).toBe("- The user's handle is gus.\n");
  });
});
