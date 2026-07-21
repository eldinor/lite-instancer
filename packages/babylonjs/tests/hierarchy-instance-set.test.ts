import "@babylonjs/core/Meshes/thinInstanceMesh.js";
import { NullEngine } from "@babylonjs/core/Engines/nullEngine.js";
import { Matrix, Vector3 } from "@babylonjs/core/Maths/math.js";
import { Mesh } from "@babylonjs/core/Meshes/mesh.js";
import { Scene } from "@babylonjs/core/scene.js";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode.js";
import { createHierarchyInstanceSet } from "../src/hierarchy-instance-set.js";
import { createPickingRegistry } from "../src/picking-registry.js";

describe("Babylon.js HierarchyInstanceSet", () => {
  it("keeps all rigid child meshes on one logical slot layout", () => {
    const engine = new NullEngine();
    const scene = new Scene(engine);
    const root = new TransformNode("root", scene);
    const body = new Mesh("body", scene);
    const trim = new Mesh("trim", scene);
    body.parent = root;
    trim.parent = body;

    const set = createHierarchyInstanceSet(root, { capacity: 1, grow: "rebuild" });
    const first = set.create({ position: [1, 0, 0] });
    const second = set.create({ position: [2, 0, 0] });
    const picking = createPickingRegistry().registerMany(set.meshes, set);
    expect(set.meshes).toEqual([body, trim]);
    expect(body.thinInstanceCount).toBe(2);
    expect(trim.thinInstanceCount).toBe(2);

    set.remove(first);
    expect(set.getPosition(second)[0]).toBe(2);
    expect(body.thinInstanceCount).toBe(1);
    expect(trim.thinInstanceCount).toBe(1);
    const secondSlot = set.getSlot(second)!;
    expect(picking.get(body, secondSlot)?.id).toBe(second);
    expect(picking.get(trim, secondSlot)?.id).toBe(second);

    const grown = set.create({ position: [3, 0, 0] });
    expect(set.capacity).toBe(2);
    expect(picking.get(body, set.getSlot(grown)!)?.id).toBe(grown);
    engine.dispose();
  });

  it("adapts logical world transforms independently for authored child transforms", () => {
    const engine = new NullEngine();
    const scene = new Scene(engine);
    const root = new TransformNode("scaled-root", scene);
    root.scaling.setAll(0.01);
    const body = new Mesh("body", scene);
    const trim = new Mesh("trim", scene);
    body.parent = root;
    body.position.x = 10;
    trim.parent = body;
    trim.position.x = 20;
    root.computeWorldMatrix(true);
    body.computeWorldMatrix(true);
    trim.computeWorldMatrix(true);

    const set = createHierarchyInstanceSet(root, { capacity: 1 });
    set.create({ position: [4, 0, 0] });
    const logical = Matrix.Translation(4, 0, 0);
    for (const mesh of [body, trim]) {
      const gpu = mesh.thinInstanceGetWorldMatrices()[0]!;
      const actual = gpu.multiply(mesh.computeWorldMatrix(true));
      const expected = mesh.computeWorldMatrix(true).multiply(logical);
      const actualOrigin = Vector3.TransformCoordinates(Vector3.Zero(), actual);
      const expectedOrigin = Vector3.TransformCoordinates(Vector3.Zero(), expected);
      expect(actualOrigin.x).toBeCloseTo(expectedOrigin.x);
      expect(actualOrigin.y).toBeCloseTo(expectedOrigin.y);
      expect(actualOrigin.z).toBeCloseTo(expectedOrigin.z);
    }
    engine.dispose();
  });
});
