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
});
