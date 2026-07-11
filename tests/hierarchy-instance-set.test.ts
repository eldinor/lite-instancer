import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@babylonjs/lite", () => ({
  createHierarchyInstancePool: vi.fn((root, capacity) => ({ root, capacity, count: 0 })),
  setHierarchyInstanceCount: vi.fn((pool, count) => {
    pool.count = count;
  }),
  setHierarchyInstanceMatrix: vi.fn((pool, index) => {
    if (index >= pool.count) {
      throw new Error("setHierarchyInstanceMatrix index must reference an active hierarchy instance");
    }
  }),
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

  it("supports transform convenience helpers for hierarchy instances", async () => {
    const { createHierarchyInstanceSet } = await import("../src/hierarchy-instance-set.js");
    const { toInstanceId } = await import("../src/types.js");
    const root = { children: [], worldMatrix: new Float32Array(16), worldMatrixVersion: 0 } as never;
    const set = createHierarchyInstanceSet(root, { capacity: 2, visibleStrategy: "scale-zero" });
    const id = set.create({ position: [1, 2, 3], scale: 2 });
    const missing = toInstanceId(999);

    expect(Array.from(set.getPosition(id))).toEqual([1, 2, 3]);
    expect(set.getPositionOrUndefined(missing)).toBeUndefined();

    set.setPosition(id, [4, 5, 6]);
    set.translate(id, [1, -2, 3]);
    set.setScale(id, [3, 4, 5]);

    const matrix = set.getMatrix(id);
    expect(Array.from(set.getPosition(id))).toEqual([5, 3, 9]);
    expect(matrix[0]).toBe(3);
    expect(matrix[5]).toBe(4);
    expect(matrix[10]).toBe(5);

    expect(set.trySetPosition(missing, [0, 0, 0])).toBe(false);
    expect(set.tryTranslate(missing, [1, 1, 1])).toBe(false);
    expect(set.trySetScale(missing, 1)).toBe(false);
  });

  it("activates scale-zero hierarchy slots before syncing their matrix", async () => {
    const { createHierarchyInstanceSet } = await import("../src/hierarchy-instance-set.js");
    const { setHierarchyInstanceCount, setHierarchyInstanceMatrix } = await import("@babylonjs/lite");
    const syncCount = vi.mocked(setHierarchyInstanceCount);
    const syncMatrix = vi.mocked(setHierarchyInstanceMatrix);
    const root = { children: [], worldMatrix: new Float32Array(16), worldMatrixVersion: 0 } as never;
    const set = createHierarchyInstanceSet(root, { capacity: 2, visibleStrategy: "scale-zero" });

    syncCount.mockClear();
    syncMatrix.mockClear();

    set.create({ position: [1, 0, 0] });

    expect(syncCount).toHaveBeenCalledWith(set.pool, 1);
    expect(syncMatrix).toHaveBeenCalledTimes(1);
    expect(syncMatrix.mock.invocationCallOrder[0]).toBeGreaterThan(syncCount.mock.invocationCallOrder[0] ?? 0);
  });

  it("syncs only dirty hierarchy slots for direct matrix updates", async () => {
    const { createHierarchyInstanceSet } = await import("../src/hierarchy-instance-set.js");
    const { setHierarchyInstanceCount, setHierarchyInstanceMatrix } = await import("@babylonjs/lite");
    const syncCount = vi.mocked(setHierarchyInstanceCount);
    const syncMatrix = vi.mocked(setHierarchyInstanceMatrix);
    const root = { children: [], worldMatrix: new Float32Array(16), worldMatrixVersion: 0 } as never;
    const set = createHierarchyInstanceSet(root, { capacity: 4, visibleStrategy: "active-count" });
    const ids = set.createMany([
      { transform: { position: [0, 0, 0] } },
      { transform: { position: [1, 0, 0] } },
      { transform: { position: [2, 0, 0] } }
    ]);

    syncCount.mockClear();
    syncMatrix.mockClear();

    set.setTransform(ids[1]!, { position: [9, 0, 0] });

    expect(syncCount).not.toHaveBeenCalled();
    expect(syncMatrix).toHaveBeenCalledTimes(1);
    expect(syncMatrix.mock.calls[0]?.[1]).toBe(set.getSlot(ids[1]!));
  });

  it("defers hierarchy batch syncs to dirty slots and handles hidden active-count updates", async () => {
    const { createHierarchyInstanceSet } = await import("../src/hierarchy-instance-set.js");
    const { setHierarchyInstanceCount, setHierarchyInstanceMatrix } = await import("@babylonjs/lite");
    const syncCount = vi.mocked(setHierarchyInstanceCount);
    const syncMatrix = vi.mocked(setHierarchyInstanceMatrix);
    const root = { children: [], worldMatrix: new Float32Array(16), worldMatrixVersion: 0 } as never;
    const set = createHierarchyInstanceSet(root, { capacity: 4, visibleStrategy: "active-count" });
    const ids = set.createMany([
      { transform: { position: [0, 0, 0] } },
      { transform: { position: [1, 0, 0] } },
      { transform: { position: [2, 0, 0] } },
      { transform: { position: [3, 0, 0] } }
    ]);
    const hidden = ids[1]!;

    syncCount.mockClear();
    syncMatrix.mockClear();
    set.setVisible(hidden, false);

    expect(syncCount).toHaveBeenCalledTimes(1);
    expect(syncMatrix).toHaveBeenCalledTimes(1);

    syncCount.mockClear();
    syncMatrix.mockClear();
    set.setTransform(hidden, { position: [9, 0, 0] });

    expect(syncCount).not.toHaveBeenCalled();
    expect(syncMatrix).not.toHaveBeenCalled();

    set.setVisible(hidden, true);

    expect(syncCount).toHaveBeenCalledTimes(1);
    expect(syncMatrix).toHaveBeenCalledTimes(1);
    expect(syncMatrix.mock.calls[0]?.[1]).toBe(set.getSlot(hidden));
  });

  it("queries and updates metadata for hierarchy instances", async () => {
    const { createHierarchyInstanceSet } = await import("../src/hierarchy-instance-set.js");
    const { toInstanceId } = await import("../src/types.js");
    const root = { children: [], worldMatrix: new Float32Array(16), worldMatrixVersion: 0 } as never;
    const set = createHierarchyInstanceSet<{ kind: "speaker" | "case"; active: boolean }>(root, { capacity: 4 });
    const [a, b, c] = set.createMany([
      { metadata: { kind: "speaker", active: false } },
      { metadata: { kind: "case", active: true } },
      { metadata: { kind: "speaker", active: true } }
    ]);
    const missing = toInstanceId(999);

    expect(set.findByMetadata((metadata) => metadata.active)).toBe(b);
    expect(set.filterByMetadata((metadata) => metadata.kind === "speaker").sort()).toEqual([a, c].sort());

    expect(set.updateMetadata(a!, (metadata) => metadata && { ...metadata, active: true })).toEqual({
      kind: "speaker",
      active: true
    });
    expect(set.getMetadata(a!)?.active).toBe(true);

    expect(set.updateMetadata(c!, () => undefined)).toBeUndefined();
    expect(set.getMetadata(c!)).toBeUndefined();
    expect(set.tryUpdateMetadata(missing, () => ({ kind: "case", active: false }))).toBeUndefined();
  });
});
