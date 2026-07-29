import { describe, expect, it } from "vitest";
import {
  demoGroups,
  demoHref,
  demos,
  getDemo,
  getDemoNeighbors,
  getGroupDemos
} from "../../examples/shared/navigation.js";

describe("Annotator demo navigation registry", () => {
  it("contains twenty uniquely identified, uniquely routed demos", () => {
    expect(demos).toHaveLength(20);
    expect(new Set(demos.map((entry) => entry.id)).size).toBe(demos.length);
    expect(new Set(demos.map((entry) => entry.route)).size).toBe(demos.length);
    for (const entry of demos) {
      expect(entry.title).not.toBe("");
      expect(entry.description).not.toBe("");
      expect(entry.api).not.toBe("");
      expect(entry.sourcePath).toBe(`examples/${entry.route}main.ts`);
    }
  });

  it("groups eight HTML and twelve GPU examples in learning order", () => {
    expect(demoGroups.map((group) => group.id)).toEqual(["html", "gpu"]);
    expect(getGroupDemos("html")).toHaveLength(8);
    expect(getGroupDemos("gpu")).toHaveLength(12);
    expect(demos.slice(0, 8).every((entry) => entry.group === "html")).toBe(true);
    expect(demos.slice(8).every((entry) => entry.group === "gpu")).toBe(true);
  });

  it("stops at sequence boundaries and crosses from HTML to GPU", () => {
    expect(getDemoNeighbors("labels")).toEqual({ next: getDemo("markers") });
    expect(getDemoNeighbors("occlusion")).toEqual({
      previous: getDemo("collision-stress"),
      next: getDemo("textrender-basic")
    });
    expect(getDemoNeighbors("textrender-stress")).toEqual({ previous: getDemo("textrender-collisions") });
    expect(getDemoNeighbors("missing")).toEqual({});
  });

  it("resolves routes relative to a nested deployment root", () => {
    const root = new URL("https://example.test/products/lite/examples/");
    expect(demoHref(root, getDemo("labels")!)).toBe("https://example.test/products/lite/examples/labels/");
    expect(demoHref(root, getDemo("textrender-collisions")!)).toBe(
      "https://example.test/products/lite/examples/textrender/collisions/"
    );
  });
});
