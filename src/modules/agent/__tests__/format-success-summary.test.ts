import { describe, it, expect } from "vitest";
import { formatSuccessSummary } from "../tools";

describe("formatSuccessSummary", () => {
  it("reports a click as the confirmation it is — coordinates are for the driver", () => {
    expect(formatSuccessSummary("click", { x: 632, y: 411 })).toBe("Clicked");
  });

  it("says where a navigation landed — the host is the row's only trace", () => {
    expect(
      formatSuccessSummary("navigate", { url: "https://www.amazon.com/gp/css/order-history" }),
    ).toBe("Navigated to amazon.com");
  });

  it("keeps the raw value when the URL will not parse", () => {
    expect(formatSuccessSummary("navigate", { url: "example.com/path" })).toBe(
      "Navigated to example.com/path",
    );
  });

  it("falls back to a bare confirmation when the navigate result carries no URL", () => {
    expect(formatSuccessSummary("navigate", {})).toBe("Navigated");
    expect(formatSuccessSummary("navigate", undefined)).toBe("Navigated");
  });

  it("names the tab a switch or group landed on", () => {
    expect(formatSuccessSummary("switch_tab", { title: "Gmail" })).toBe("Switched to Gmail");
    expect(formatSuccessSummary("group_tab", { title: "Gmail" })).toBe("Grouped Gmail");
  });
});
