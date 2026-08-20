import { describe, expect, it } from "vitest";

// The poses are the brand mark in other postures, which only works while they
// are demonstrably the SAME object as the icon. The guard that matters is the
// geometry: every pose must draw the body from `COMET_GEOMETRY`, so a future
// edit to the mark moves the illustrations with it and a hand-typed path in
// here fails instead of quietly forking a fourth copy of the comet.

import { act } from "react";
import { createRoot } from "react-dom/client";
import type { Root } from "react-dom/client";
import { CometPose, type Pose } from "../CometPose";
import { COMET_GEOMETRY, cometSvg } from "@/shared/logo";

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

const POSES: Pose[] = ["ready", "resting", "waiting", "blocked"];

async function render(pose: Pose) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root: Root = createRoot(container);
  await act(async () => root.render(<CometPose pose={pose} size={48} />));
  return container;
}

describe("comet poses", () => {
  it.each(POSES)("draws %s from the mark's own geometry", async (pose) => {
    const container = await render(pose);
    const body = container.querySelector(`path[d="${COMET_GEOMETRY.tab}"]`);
    expect(body).not.toBeNull();
  });

  it("keeps the icon builder reading the same ruler", () => {
    // cometSvg is what public/icon/* is rasterized from. If it ever stops
    // interpolating the shared constants, the poses and the installed icon can
    // drift apart without anything else noticing.
    const svg = cometSvg("full");
    expect(svg).toContain(COMET_GEOMETRY.tab);
    expect(svg).toContain(`cx="${COMET_GEOMETRY.dot.cx}"`);
    // Both trails run INTO the body, so both end at the same x.
    const { endX } = COMET_GEOMETRY.trail;
    expect(svg).toContain(`x="${endX - 12}"`);
    expect(svg).toContain(`x="${endX - 9}"`);
  });

  it("gives only `ready` a route, and only that route moves", async () => {
    const ready = await render("ready");
    expect(ready.querySelector(".comet-runway")).not.toBeNull();

    for (const pose of POSES.filter((p) => p !== "ready")) {
      const container = await render(pose);
      expect(container.querySelector(".comet-runway")).toBeNull();
    }
  });

  it("leans the body and its dot together, or neither", async () => {
    // A dot that stayed upright while the body tipped would slide off the tab.
    const blocked = await render("blocked");
    const rotations = [...blocked.querySelectorAll("[transform]")]
      .map((el) => el.getAttribute("transform"))
      .filter((t): t is string => t !== null && t.startsWith("rotate("));
    expect(rotations).toHaveLength(2);
    expect(new Set(rotations).size).toBe(1);

    const upright = await render("waiting");
    const uprightRotations = [...upright.querySelectorAll("[transform]")].filter((el) =>
      el.getAttribute("transform")?.startsWith("rotate("),
    );
    expect(uprightRotations).toHaveLength(0);
  });
});
