import { describe, expect, it } from "vitest";
import {
  advanceOcclusionHysteresis,
  type OcclusionHysteresisState
} from "../../src/occlusion-hysteresis.js";

function advance(
  sequence: readonly ("visible" | "occluded")[],
  enter = 2,
  exit = 2
): OcclusionHysteresisState[] {
  const states: OcclusionHysteresisState[] = [];
  let state: OcclusionHysteresisState | undefined;
  for (const raw of sequence) {
    state = advanceOcclusionHysteresis(state, raw, enter, exit);
    states.push(state);
  }
  return states;
}

describe("occlusion hysteresis", () => {
  it("requires consecutive samples when entering and leaving occlusion", () => {
    const states = advance([
      "visible",
      "occluded",
      "visible",
      "occluded",
      "occluded",
      "visible",
      "visible"
    ]);
    expect(states.map(({ state }) => state)).toEqual([
      "visible",
      "visible",
      "visible",
      "visible",
      "occluded",
      "occluded",
      "visible"
    ]);
  });

  it("supports independent enter and exit thresholds", () => {
    const states = advance(
      ["occluded", "occluded", "occluded", "visible", "visible"],
      3,
      2
    );
    expect(states.map(({ state }) => state)).toEqual([
      "unknown",
      "unknown",
      "occluded",
      "occluded",
      "visible"
    ]);
  });
});
