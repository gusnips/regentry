import { describe, it, expect } from "vitest";
import { splitErrorDetail } from "../error-detail";

describe("splitErrorDetail", () => {
  it("splits a provider error into summary and JSON detail", () => {
    const msg =
      'Provider error: Anthropic API error 400: {"error":{"type":"invalid_request_error","message":"Invalid request Error"},"type":"error"}';
    expect(splitErrorDetail(msg)).toEqual({
      summary: "Provider error: Anthropic API error 400",
      detail:
        '{"error":{"type":"invalid_request_error","message":"Invalid request Error"},"type":"error"}',
    });
  });

  it("leaves plain messages untouched", () => {
    expect(splitErrorDetail("No active tab found.")).toEqual({ summary: "No active tab found." });
  });

  it("leaves messages with non-JSON braces untouched", () => {
    const msg = "tool input_schema {type: object} was rejected";
    expect(splitErrorDetail(msg)).toEqual({ summary: msg });
  });

  it("strips the trailing colon and whitespace before the JSON", () => {
    expect(splitErrorDetail('HTTP 500:  {"oops":true}')).toEqual({
      summary: "HTTP 500",
      detail: '{"oops":true}',
    });
  });
});
