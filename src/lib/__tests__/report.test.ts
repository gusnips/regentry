import { describe, it, expect, beforeEach } from "vitest";
import { newIssueUrl, type ReportProvider } from "../report";

/** The manifest is the only chrome surface report.ts touches. */
beforeEach(() => {
  (globalThis as Record<string, unknown>).chrome = {
    runtime: { getManifest: () => ({ version: "9.9.9" }) },
  };
});

/** Shaped like a real ProviderConfig — the secret-bearing fields included. */
const config = {
  id: "p1",
  name: "Anthropic",
  shape: "anthropic",
  baseUrl: "https://gateway.corp.internal/v1/proxy?tenant=acme",
  apiKey: "sk-ant-SUPERSECRET",
  model: "claude-sonnet-4-5",
  createdAt: 0,
};

const bodyOf = (url: string) => new URL(url).searchParams.get("body") ?? "";

describe("newIssueUrl", () => {
  it("opens a new issue on the project repo", () => {
    const url = new URL(newIssueUrl());
    expect(url.origin + url.pathname).toBe("https://github.com/tabrunner/tabrunner/issues/new");
  });

  it("carries the version and the provider, and never the key", () => {
    const body = bodyOf(newIssueUrl({ provider: config }));
    expect(body).toContain("TabRunner 9.9.9");
    expect(body).toContain("Anthropic");
    expect(body).toContain("claude-sonnet-4-5");
    expect(body).not.toContain("SUPERSECRET");
  });

  it("reports the endpoint host without its path", () => {
    const body = bodyOf(newIssueUrl({ provider: config }));
    expect(body).toContain("gateway.corp.internal");
    expect(body).not.toContain("tenant=acme");
  });

  it("says so when no provider is configured", () => {
    expect(bodyOf(newIssueUrl())).toContain("none configured");
  });

  it("survives a base URL that isn't one", () => {
    const broken: ReportProvider = { name: "Local", shape: "openai", baseUrl: "not a url" };
    expect(() => newIssueUrl({ provider: broken })).not.toThrow();
  });

  it("titles the issue from the error's first line only", () => {
    const url = new URL(newIssueUrl({ error: "Anthropic API error 400\n{...}" }));
    expect(url.searchParams.get("title")).toBe("Anthropic API error 400");
    expect(bodyOf(url.toString())).toContain("Anthropic API error 400");
  });

  it("leaves the title to the user when there is no error", () => {
    expect(new URL(newIssueUrl()).searchParams.get("title")).toBeNull();
  });

  it("truncates a huge error so the URL stays under GitHub's ceiling", () => {
    const url = newIssueUrl({ provider: config, error: "x".repeat(50_000) });
    expect(url.length).toBeLessThan(8192);
  });
});
