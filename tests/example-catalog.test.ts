import { describe, expect, it } from "vitest";
import {
  EXAMPLES,
  EXAMPLE_CATEGORIES,
  examplePath,
  getExampleNeighbors
} from "../examples/shared/catalog.js";

describe("example catalog", () => {
  it("contains unique and routable entries", () => {
    expect(new Set(EXAMPLES.map((entry) => entry.id)).size).toBe(EXAMPLES.length);
    for (const entry of EXAMPLES) {
      expect(EXAMPLE_CATEGORIES).toContain(entry.category);
      expect(examplePath(entry)).toBe(`/examples/${entry.id}/`);
    }
  });

  it("links entries in catalog order", () => {
    expect(getExampleNeighbors(EXAMPLES[0]!.id)).toEqual({ next: EXAMPLES[1] });
    expect(getExampleNeighbors(EXAMPLES[1]!.id)).toEqual({
      previous: EXAMPLES[0],
      next: EXAMPLES[2]
    });
    expect(getExampleNeighbors(EXAMPLES.at(-1)!.id)).toEqual({
      previous: EXAMPLES.at(-2)
    });
    expect(getExampleNeighbors("missing")).toEqual({});
  });
});
