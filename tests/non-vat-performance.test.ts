import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@babylonjs/lite", () => ({
  setThinInstances: vi.fn((mesh, matrices, count) => {
    mesh.thinInstances = { matrices, count };
  }),
  setThinInstanceCount: vi.fn((mesh, count) => {
    mesh.thinInstances.count = count;
  }),
  setThinInstanceDrawCount: vi.fn((mesh, count) => {
    mesh.thinInstances.count = count;
  }),
  enableThinInstanceDynamicDrawCount: vi.fn(),
  setThinInstanceMatrix: vi.fn((mesh, index, matrix) => {
    mesh.thinInstances.matrices.set(matrix, index * 16);
  }),
  setThinInstanceColors: vi.fn((mesh, colors) => {
    mesh.thinInstances.colors = colors;
  }),
  setThinInstanceColor: vi.fn(),
  flushThinInstances: vi.fn(),
  createHierarchyInstancePool: vi.fn((root, capacity) => ({ root, capacity, count: 0 })),
  setHierarchyInstanceCount: vi.fn((pool, count) => {
    pool.count = count;
  }),
  setHierarchyInstanceMatrix: vi.fn(),
  invalidateRenderBundles: vi.fn(),
  enableThinInstanceGpuCulling: vi.fn()
}));

describe("non-VAT renderer work boundaries", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  it("coalesces ordinary lifecycle work and preserves bounded matrix dirty bytes", async () => {
    const { createInstanceSet } = await import("../src/instance-set.js");
    const {
      flushThinInstances,
      invalidateRenderBundles,
      setThinInstanceCount,
      setThinInstanceDrawCount,
      setThinInstanceMatrix
    } = await import("@babylonjs/lite");
    const syncCount = vi.mocked(setThinInstanceCount);
    const syncDrawCount = vi.mocked(setThinInstanceDrawCount);
    const syncMatrix = vi.mocked(setThinInstanceMatrix);
    const fullFlush = vi.mocked(flushThinInstances);
    const invalidate = vi.mocked(invalidateRenderBundles);
    const mesh = {} as never;
    const set = createInstanceSet(mesh, { capacity: 8, engine: {} as never });

    vi.clearAllMocks();
    const ids = set.createMany(Array.from({ length: 4 }, (_, index) => ({ transform: { position: [index, 0, 0] } })));

    expect(syncDrawCount).toHaveBeenCalledTimes(1);
    expect(syncCount).not.toHaveBeenCalled();
    expect(syncMatrix).toHaveBeenCalledTimes(4);
    expect(syncDrawCount.mock.invocationCallOrder[0]).toBeLessThan(syncMatrix.mock.invocationCallOrder[0] ?? 0);
    expect(fullFlush).not.toHaveBeenCalled();
    expect(invalidate).not.toHaveBeenCalled();

    vi.clearAllMocks();
    set.setTransforms([
      { id: ids[1]!, transform: { position: [10, 0, 0] } },
      { id: ids[2]!, transform: { position: [11, 0, 0] } }
    ]);

    const dirtySlots = syncMatrix.mock.calls.map((call) => call[1]);
    const dirtySpanBytes = ((Math.max(...dirtySlots) - Math.min(...dirtySlots)) + 1) * 16 * Float32Array.BYTES_PER_ELEMENT;
    expect(dirtySlots).toEqual([1, 2]);
    expect(dirtySpanBytes).toBe(128);
    expect(fullFlush).not.toHaveBeenCalled();
    expect(invalidate).not.toHaveBeenCalled();

    vi.clearAllMocks();
    set.setPosition(ids[0]!, [20, 0, 0]);
    set.translate(ids[1]!, [1, 0, 0]);
    expect(syncMatrix).toHaveBeenCalledTimes(2);
    expect(syncMatrix.mock.calls[0]?.[2]).toBe(syncMatrix.mock.calls[1]?.[2]);

    vi.clearAllMocks();
    const slice = vi.spyOn(Float32Array.prototype, "slice");
    expect(set.removeMany([ids[0]!, ids[1]!])).toBe(2);
    expect(slice).not.toHaveBeenCalled();
    slice.mockRestore();
    expect(syncDrawCount).toHaveBeenCalledTimes(1);
    expect(syncCount).not.toHaveBeenCalled();
    expect(fullFlush).not.toHaveBeenCalled();
    expect(invalidate).not.toHaveBeenCalled();

    vi.clearAllMocks();
    set.reserve(16);
    expect(invalidate).toHaveBeenCalledTimes(1);
  });

  it("orders dynamic count before newly exposed matrix/color ranges and falls back during warm-up", async () => {
    const { createInstanceSet } = await import("../src/instance-set.js");
    const {
      setThinInstanceColor,
      setThinInstanceCount,
      setThinInstanceDrawCount,
      setThinInstanceMatrix
    } = await import("@babylonjs/lite");
    const syncColor = vi.mocked(setThinInstanceColor);
    const syncCount = vi.mocked(setThinInstanceCount);
    const syncDrawCount = vi.mocked(setThinInstanceDrawCount);
    const syncMatrix = vi.mocked(setThinInstanceMatrix);
    const set = createInstanceSet({} as never, { capacity: 4, colors: true });

    vi.clearAllMocks();
    set.createMany([{}, {}]);

    expect(syncDrawCount).toHaveBeenCalledTimes(1);
    expect(syncMatrix).toHaveBeenCalledTimes(2);
    expect(syncColor).toHaveBeenCalledTimes(2);
    expect(syncDrawCount.mock.invocationCallOrder[0]).toBeLessThan(syncMatrix.mock.invocationCallOrder[0] ?? 0);
    expect(syncDrawCount.mock.invocationCallOrder[0]).toBeLessThan(syncColor.mock.invocationCallOrder[0] ?? 0);

    vi.clearAllMocks();
    syncDrawCount.mockImplementationOnce(() => {
      throw new Error("setThinInstanceDrawCount requires a fully synchronized fixed-capacity pool");
    });
    set.create();

    expect(syncDrawCount).toHaveBeenCalledTimes(1);
    expect(syncCount).toHaveBeenCalledTimes(1);
    expect(syncCount.mock.invocationCallOrder[0]).toBeLessThan(syncMatrix.mock.invocationCallOrder[0] ?? 0);
  });

  it("coalesces hierarchy lifecycle work and invalidates only for pool rebuilds", async () => {
    const { createHierarchyInstanceSet } = await import("../src/hierarchy-instance-set.js");
    const {
      invalidateRenderBundles,
      setHierarchyInstanceCount,
      setHierarchyInstanceMatrix
    } = await import("@babylonjs/lite");
    const syncCount = vi.mocked(setHierarchyInstanceCount);
    const syncMatrix = vi.mocked(setHierarchyInstanceMatrix);
    const invalidate = vi.mocked(invalidateRenderBundles);
    const root = { children: [], worldMatrix: new Float32Array(16), worldMatrixVersion: 0 } as never;
    const set = createHierarchyInstanceSet(root, {
      capacity: 8,
      grow: "rebuild",
      engine: {} as never
    });

    vi.clearAllMocks();
    const ids = set.createMany(Array.from({ length: 4 }, (_, index) => ({ transform: { position: [index, 0, 0] } })));

    expect(syncCount).toHaveBeenCalledTimes(1);
    expect(syncMatrix).toHaveBeenCalledTimes(4);
    expect(invalidate).not.toHaveBeenCalled();

    vi.clearAllMocks();
    set.setPosition(ids[0]!, [20, 0, 0]);
    set.translate(ids[1]!, [1, 0, 0]);
    expect(syncMatrix).toHaveBeenCalledTimes(2);
    expect(syncMatrix.mock.calls[0]?.[2]).toBe(syncMatrix.mock.calls[1]?.[2]);

    vi.clearAllMocks();
    const slice = vi.spyOn(Float32Array.prototype, "slice");
    expect(set.removeMany([ids[0]!, ids[1]!])).toBe(2);
    expect(slice).not.toHaveBeenCalled();
    slice.mockRestore();
    expect(syncCount).toHaveBeenCalledTimes(1);
    expect(invalidate).not.toHaveBeenCalled();

    vi.clearAllMocks();
    set.reserve(16);
    expect(invalidate).toHaveBeenCalledTimes(1);
  });
});
