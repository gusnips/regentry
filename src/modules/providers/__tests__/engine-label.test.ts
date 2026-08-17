import { describe, expect, it } from "vitest";
import { engineLabel } from "../ui/engine-label";

// The trigger chip's one-line contract: auto names its resolution, a pinned
// model stands alone, and effort rides only when the user set one.
describe("engineLabel", () => {
  it("names auto's resolution so it never reads as pinned", () => {
    expect(engineLabel({ auto: true, modelName: "Claude Sonnet 4.5", autoText: "Auto" })).toBe(
      "Auto · Claude Sonnet 4.5",
    );
  });

  it("degrades to bare Auto when nothing resolves yet", () => {
    expect(engineLabel({ auto: true, autoText: "Auto" })).toBe("Auto");
  });

  it("shows the pinned model without the auto qualifier", () => {
    expect(engineLabel({ auto: false, modelName: "gpt-5.4", autoText: "Auto" })).toBe("gpt-5.4");
  });

  it("appends effort only when set", () => {
    expect(
      engineLabel({ auto: false, modelName: "gpt-5.4", autoText: "Auto", effortLabel: "High" }),
    ).toBe("gpt-5.4 · High");
    expect(engineLabel({ auto: true, modelName: "X", autoText: "Auto" })).toBe("Auto · X");
  });
});
