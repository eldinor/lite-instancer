import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@babylonjs/lite", () => ({
  createHierarchyInstancePool: vi.fn((root, capacity) => ({ root, capacity, count: 0 })),
  setHierarchyInstanceCount: vi.fn((pool, count) => {
    pool.count = count;
  }),
  setHierarchyInstanceMatrix: vi.fn(),
  invalidateRenderBundles: vi.fn(),
  enableThinInstanceGpuCulling: vi.fn()
}));

describe("HierarchyInstanceSet", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("rebuilds capacity when configured", async () => {
    const { createHierarchyInstanceSet } = await import("../src/hierarchy-instance-set.js");
    const root = { children: [], worldMatrix: new Float32Array(16), worldMatrixVersion: 0 } as never;
    const set = createHierarchyInstanceSet(root, { capacity: 1, grow: "rebuild" });
    const a = set.create();
    const b = set.create();

    expect(set.capacity).toBeGreaterThanOrEqual(2);
    expect(set.has(a)).toBe(true);
    expect(set.has(b)).toBe(true);
  });

  it("removes the selected hierarchy id instead of the swapped slot id", async () => {
    const { createHierarchyInstanceSet } = await import("../src/hierarchy-instance-set.js");
    const root = { children: [], worldMatrix: new Float32Array(16), worldMatrixVersion: 0 } as never;
    const set = createHierarchyInstanceSet<{ label: string }>(root, { capacity: 8, visibleStrategy: "active-count" });
    const ids = Array.from({ length: 8 }, (_, index) => set.create(undefined, { label: `boombox-${index}-0` }));
    const selected = ids[0];
    const last = ids[7];

    expect(selected).toBeDefined();
    expect(last).toBeDefined();
    expect(set.remove(selected!)).toBe(true);

    expect(set.has(selected!)).toBe(false);
    expect(set.has(last!)).toBe(true);
    expect(set.getMetadata(last!)?.label).toBe("boombox-7-0");
    expect(set.getIdForSlot(set.getSlot(last!) ?? -1)).toBe(last);
  });

  it("supports shared base helpers for hierarchy instances", async () => {
    const { createHierarchyInstanceSet } = await import("../src/hierarchy-instance-set.js");
    const { toInstanceId } = await import("../src/types.js");
    const root = { children: [], worldMatrix: new Float32Array(16), worldMatrixVersion: 0 } as never;
    const set = createHierarchyInstanceSet<{ label: string }>(root, {
      capacity: 2,
      grow: "rebuild",
      visibleStrategy: "active-count"
    });
    const [a, b, c] = set.createMany([
      { transform: { position: [0, 0, 0] }, metadata: { label: "a" } },
      { transform: { position: [1, 0, 0] }, metadata: { label: "b" } },
      { transform: { position: [2, 0, 0] }, metadata: { label: "c" } }
    ]);
    const missing = toInstanceId(999);

    expect(set.capacity).toBeGreaterThanOrEqual(3);
    expect(Array.from(set.ids()).sort()).toEqual([a, b, c].sort());
    expect(Array.from(set.entries()).map((entry) => entry.metadata?.label).sort()).toEqual(["a", "b", "c"]);

    expect(set.trySetTransform(missing, { position: [9, 0, 0] })).toBe(false);
    expect(set.getMatrixOrUndefined(missing)).toBeUndefined();

    set.setTransforms([{ id: c!, transform: { position: [5, 0, 0] } }]);
    set.setVisibleMany([a!, b!], false);

    expect(set.getMatrix(c!)[12]).toBe(5);
    expect(Array.from(set.visibleIds())).toEqual([c]);
    expect(set.removeMany([b!, missing])).toBe(1);
    expect(set.has(b!)).toBe(false);
  });
});
