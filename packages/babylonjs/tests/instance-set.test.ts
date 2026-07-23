import "@babylonjs/core/Meshes/thinInstanceMesh.js";
import { NullEngine } from "@babylonjs/core/Engines/nullEngine.js";
import { Vector3 } from "@babylonjs/core/Maths/math.js";
import { Mesh } from "@babylonjs/core/Meshes/mesh.js";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder.js";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode.js";
import { Scene } from "@babylonjs/core/scene.js";
import { createInstanceSet } from "../src/instance-set.js";
import { createPickingRegistry } from "../src/picking-registry.js";
import { getInstanceSetWorldCenter } from "../src/screen-space-picking.js";

describe("Babylon.js InstanceSet", () => {
  function setup() {
    const engine = new NullEngine();
    const scene = new Scene(engine);
    const mesh = new Mesh("source", scene);
    return { engine, scene, mesh };
  }

  it("preserves stable IDs across removal and slot compaction", () => {
    const { engine, mesh } = setup();
    const set = createInstanceSet<{ label: string }>(mesh, { capacity: 3, engine });
    const upload = vi.spyOn(mesh, "thinInstancePartialBufferUpdate");
    const a = set.create({ position: [1, 0, 0] }, { label: "a" });
    const b = set.create({ position: [2, 0, 0] }, { label: "b" });
    const c = set.create({ position: [3, 0, 0] }, { label: "c" });

    expect(set.remove(b)).toBe(true);
    expect(set.has(a)).toBe(true);
    expect(set.has(c)).toBe(true);
    expect(set.getPosition(c)[0]).toBe(3);
    expect(set.getMetadata(c)).toEqual({ label: "c" });
    expect(mesh.thinInstanceCount).toBe(2);
    expect(upload).toHaveBeenCalledWith("matrix", 1, 0);
    engine.dispose();
  });

  it("supports visibility strategies, growth, colors, and batches", () => {
    const { engine, mesh } = setup();
    const set = createInstanceSet(mesh, { capacity: 1, grow: "double", colors: true, visibleStrategy: "scale-zero" });
    const first = set.create({ position: [1, 2, 3] });
    const second = set.create({ position: [4, 5, 6] });
    expect(set.capacity).toBe(2);

    set.setVisible(first, false);
    expect(set.visibleCount).toBe(1);
    expect(set.getPosition(first)).toEqual(new Float32Array([1, 2, 3]));

    set.batch((writer) => {
      writer.setPosition(first, [7, 8, 9]);
      writer.setVisible(first, true);
      writer.setPosition(second, [10, 11, 12]);
    });
    set.setColor(first, [0.25, 0.5, 0.75, 1]);
    expect(set.getPosition(first)).toEqual(new Float32Array([7, 8, 9]));
    expect(set.getColor(first)).toEqual(new Float32Array([0.25, 0.5, 0.75, 1]));
    expect(mesh.thinInstanceCount).toBe(2);
    engine.dispose();
  });

  it("coalesces adjacent matrix updates into one batch upload", () => {
    const { engine, mesh } = setup();
    const set = createInstanceSet(mesh, { capacity: 4 });
    const first = set.create();
    const second = set.create();
    const upload = vi.spyOn(mesh, "thinInstancePartialBufferUpdate");
    upload.mockClear();

    set.batch((writer) => {
      writer.setPosition(first, [1, 0, 0]);
      writer.setPosition(second, [2, 0, 0]);
    });

    expect(upload).toHaveBeenCalledTimes(1);
    expect(upload).toHaveBeenCalledWith("matrix", 2, 0);
    set.dispose();
    expect(mesh.hasThinInstances).toBe(false);
    engine.dispose();
  });

  it("batches bulk lifecycle work and keeps default colors white", () => {
    const { engine, mesh } = setup();
    const set = createInstanceSet(mesh, { capacity: 4, grow: "double", colors: true });
    const uploads = vi.spyOn(mesh, "thinInstancePartialBufferUpdate");
    const bounds = vi.spyOn(mesh, "thinInstanceRefreshBoundingInfo");
    uploads.mockClear();
    bounds.mockClear();

    const ids = set.createMany([
      { transform: { position: [0, 0, 0] } },
      { transform: { position: [1, 0, 0] } },
      { transform: { position: [2, 0, 0] } }
    ]);

    expect(uploads.mock.calls.filter(([kind]) => kind === "matrix")).toEqual([["matrix", 3, 0]]);
    expect(uploads.mock.calls.filter(([kind]) => kind === "color")).toEqual([["color", 3, 0]]);
    expect(bounds.mock.calls.length).toBeLessThanOrEqual(2);
    expect(set.getColor(ids[1]!)).toEqual(new Float32Array([1, 1, 1, 1]));

    uploads.mockClear();
    bounds.mockClear();
    expect(set.removeMany([ids[0]!, ids[2]!])).toBe(2);
    expect(bounds.mock.calls.length).toBeLessThanOrEqual(2);
    expect(uploads.mock.calls.filter(([kind]) => kind === "matrix").length).toBeLessThanOrEqual(1);
    engine.dispose();
  });

  it("disposes idempotently and rejects later use", () => {
    const { engine, mesh } = setup();
    const set = createInstanceSet(mesh, { colors: true });
    const id = set.create();
    set.dispose();
    expect(() => set.dispose()).not.toThrow();
    expect(() => set.has(id)).toThrow(/disposed/);
    expect(() => set.create()).toThrow(/disposed/);
    engine.dispose();
  });

  it("validates unknown IDs before returning a default color", () => {
    const { engine, mesh } = setup();
    const set = createInstanceSet(mesh);
    expect(() => set.getColor(123 as never)).toThrow(/Unknown instance id/);
    engine.dispose();
  });

  it("refreshes aggregate bounds so every rendered instance can be picked", () => {
    const engine = new NullEngine();
    const scene = new Scene(engine);
    const mesh = MeshBuilder.CreateBox("pickable-source", { size: 1 }, scene);
    const set = createInstanceSet(mesh, { capacity: 2, grow: "double" });

    set.create({ position: [-8, 0, 0] });
    set.create({ position: [8, 0, 0] });

    const bounds = mesh.getBoundingInfo().boundingBox;
    expect(bounds.minimum.x).toBeLessThanOrEqual(-8.5);
    expect(bounds.maximum.x).toBeGreaterThanOrEqual(8.5);
    engine.dispose();
  });

  it("performs exactly one automatic bounds scan per batch", () => {
    const engine = new NullEngine();
    const scene = new Scene(engine);
    const mesh = MeshBuilder.CreateBox("single-auto-bounds", { size: 1 }, scene);
    const set = createInstanceSet(mesh, { capacity: 4, boundsMode: "auto" });
    const refresh = vi.spyOn(mesh, "thinInstanceRefreshBoundingInfo");
    set.createMany([
      { transform: { position: [-3, 0, 0] } },
      { transform: { position: [0, 0, 0] } },
      { transform: { position: [3, 0, 0] } }
    ]);
    expect(refresh).toHaveBeenCalledTimes(1);
    set.batch((writer) => {
      for (const id of set.ids()) writer.translate(id, [0, 1, 0]);
    });
    expect(refresh).toHaveBeenCalledTimes(2);
    set.dispose();
    expect(mesh.doNotSyncBoundingInfo).toBe(false);
    engine.dispose();
  });

  it("supports manual bounds refresh without automatic population scans", () => {
    const engine = new NullEngine();
    const scene = new Scene(engine);
    const mesh = MeshBuilder.CreateBox("manual-bounds", { size: 1 }, scene);
    const set = createInstanceSet(mesh, { capacity: 4, boundsMode: "manual" });
    const refresh = vi.spyOn(mesh, "thinInstanceRefreshBoundingInfo");
    set.createMany([
      { transform: { position: [-8, 0, 0] } },
      { transform: { position: [8, 0, 0] } }
    ]);
    expect(refresh).not.toHaveBeenCalled();
    set.refreshBounds();
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(mesh.getBoundingInfo().boundingBox.minimum.x).toBeLessThanOrEqual(-8.5);
    engine.dispose();
  });

  it("uses conservative fixed bounds without thin-instance scans and restores source bounds", () => {
    const engine = new NullEngine();
    const scene = new Scene(engine);
    const mesh = MeshBuilder.CreateBox("fixed-bounds", { size: 1 }, scene);
    const originalMinimum = mesh.getBoundingInfo().minimum.clone();
    const set = createInstanceSet(mesh, {
      capacity: 4,
      boundsMode: "fixed",
      fixedBounds: { minimum: [-20, -3, -2], maximum: [20, 3, 2] }
    });
    const refresh = vi.spyOn(mesh, "thinInstanceRefreshBoundingInfo");
    set.createMany([
      { transform: { position: [-8, 0, 0] } },
      { transform: { position: [8, 0, 0] } }
    ]);
    expect(refresh).not.toHaveBeenCalled();
    expect(mesh.getBoundingInfo().minimum.x).toBe(-20);
    expect(mesh.getBoundingInfo().maximum.x).toBe(20);
    set.refreshBounds();
    expect(refresh).not.toHaveBeenCalled();
    set.dispose();
    expect(mesh.getBoundingInfo().minimum.x).toBeCloseTo(originalMinimum.x);
    engine.dispose();
  });

  it("requires valid fixed bounds", () => {
    const { engine, mesh } = setup();
    expect(() => createInstanceSet(mesh, { boundsMode: "fixed" })).toThrow(/fixedBounds/);
    expect(() => createInstanceSet(mesh, {
      boundsMode: "fixed",
      fixedBounds: { minimum: [1, 0, 0], maximum: [-1, 1, 1] }
    })).toThrow(/finite minimum/);
    engine.dispose();
  });

  it("shows an active-count instance again by stable ID after hiding it", () => {
    const { engine, mesh } = setup();
    const set = createInstanceSet(mesh, { capacity: 3 });
    set.create({ position: [-2, 0, 0] });
    const selected = set.create({ position: [0, 0, 0] });
    set.create({ position: [2, 0, 0] });

    set.setVisible(selected, false);
    expect(set.getVisible(selected)).toBe(false);
    expect(mesh.thinInstanceCount).toBe(2);

    const upload = vi.spyOn(mesh, "thinInstancePartialBufferUpdate");
    set.setVisible(selected, true);
    expect(set.getVisible(selected)).toBe(true);
    expect(set.getPosition(selected)).toEqual(new Float32Array([0, 0, 0]));
    expect(mesh.thinInstanceCount).toBe(3);
    expect(upload).toHaveBeenCalledWith("matrix", 1, 2);
    engine.dispose();
  });

  it("rejects mismatched engines and unsupported GPU-culling requests", () => {
    const { engine, mesh } = setup();
    const other = new NullEngine();
    expect(() => createInstanceSet(mesh, { engine: other })).toThrow(/does not match/);
    expect(() => createInstanceSet(mesh, { gpuCulling: true })).toThrow(/not supported/);
    other.dispose();
    engine.dispose();
  });

  it("maps picks to IDs and restores mesh picking state", () => {
    const { engine, mesh } = setup();
    const set = createInstanceSet(mesh);
    const id = set.create();
    mesh.thinInstanceEnablePicking = false;
    const registry = createPickingRegistry().register(mesh, set);
    expect(mesh.thinInstanceEnablePicking).toBe(true);
    expect(registry.fromPick({ pickedMesh: mesh, thinInstanceIndex: 0 })?.id).toBe(id);
    registry.unregister(mesh);
    expect(mesh.thinInstanceEnablePicking).toBe(false);
    engine.dispose();
  });

  it("keeps logical picking stable after compaction and growth", () => {
    const { engine, mesh } = setup();
    const set = createInstanceSet(mesh, { capacity: 2, grow: "double" });
    const first = set.create();
    const removed = set.create();
    const registry = createPickingRegistry().register(mesh, set);

    set.remove(removed);
    const grown = set.create({ position: [4, 0, 0] });
    set.create({ position: [8, 0, 0] });
    expect(set.capacity).toBe(4);
    expect(registry.get(mesh, set.getSlot(first)!)?.id).toBe(first);
    expect(registry.get(mesh, set.getSlot(grown)!)?.id).toBe(grown);
    engine.dispose();
  });

  it("keeps public transforms in world space under an authored mesh scale", () => {
    const engine = new NullEngine();
    const scene = new Scene(engine);
    const parent = new TransformNode("centimeter-root", scene);
    parent.scaling.setAll(0.01);
    const mesh = MeshBuilder.CreateBox("scaled-source", { size: 100 }, scene);
    mesh.parent = parent;
    mesh.computeWorldMatrix(true);
    const set = createInstanceSet(mesh, { capacity: 1 });
    const id = set.create({ position: [4, 0, 0] });

    expect(set.getPosition(id)[0]).toBe(4);
    const gpuMatrix = mesh.thinInstanceGetWorldMatrices()[0]!;
    const renderedWorld = gpuMatrix.multiply(mesh.computeWorldMatrix(true));
    expect(Vector3.TransformCoordinates(Vector3.Zero(), renderedWorld).x).toBeCloseTo(4);
    expect(getInstanceSetWorldCenter(set, id)[0]).toBeCloseTo(4);
    engine.dispose();
  });
});
