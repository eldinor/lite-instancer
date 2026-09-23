import { createTransformNode, type SceneNode, type ThinInstanceData } from "@babylonjs/lite";
import { describe, expect, it } from "vitest";
import { createHierarchyInstanceSet } from "../src/hierarchy-instance-set.js";

describe("Babylon Lite 1.31 hierarchy compatibility", () => {
  it("composes an identity instance above a mirrored glTF-style template root", () => {
    const root = createTransformNode("__root__", 0, 0, 0, 0, 0, 0, 1, -1, 1, 1) as SceneNode & {
      _gpu: object;
      material: object;
      thinInstances: ThinInstanceData | null;
    };
    root._gpu = {};
    root.material = {};
    root.thinInstances = null;

    const instances = createHierarchyInstanceSet(root, { capacity: 1 });
    instances.create();

    const matrix = Array.from(root.thinInstances!.matrices.subarray(0, 16), (value) => value || 0);
    expect(matrix).toEqual([
      1, 0, 0, 0,
      0, 1, 0, 0,
      0, 0, 1, 0,
      0, 0, 0, 1
    ]);
  });
});
