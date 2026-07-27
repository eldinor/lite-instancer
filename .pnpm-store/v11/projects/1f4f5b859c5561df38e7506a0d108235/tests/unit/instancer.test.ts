import { describe, expect, it, vi } from "vitest";

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
  setThinInstanceColors: vi.fn(),
  setThinInstanceColor: vi.fn(),
  flushThinInstances: vi.fn(),
  invalidateRenderBundles: vi.fn(),
  enableThinInstanceGpuCulling: vi.fn()
}));

describe("Instancer annotation anchor", () => {
  it("follows a stable ID through slot moves, visibility, growth, and removal", async () => {
    const { createInstanceSet } = await import("@litools/instancer");
    const { createInstanceAnchor } = await import("../../src/instancer.js");
    const mesh = {} as never;
    const set = createInstanceSet(mesh, { capacity: 2, visibleStrategy: "active-count" });
    const first = set.create({ position: [1, 0, 0] });
    const survivor = set.create({ position: [2, 0, 0] });
    const anchor = createInstanceAnchor(set, survivor, { localPoint: [0, 1, 0] });
    const out = new Float32Array(3);

    expect(anchor.resolve(out)).toMatchObject({ available: true, targetVisible: true });
    expect(Array.from(out)).toEqual([2, 1, 0]);
    set.remove(first);
    set.create({ position: [3, 0, 0] });
    set.create({ position: [4, 0, 0] });
    set.setPosition(survivor, [5, 0, 0]);
    anchor.resolve(out);
    expect(Array.from(out)).toEqual([5, 1, 0]);
    set.setVisible(survivor, false);
    expect(anchor.resolve(out).targetVisible).toBe(false);
    set.remove(survivor);
    expect(anchor.resolve(out).available).toBe(false);
  });

  it("uses caller-provided local bounds for instance presets", async () => {
    const { createInstanceSet } = await import("@litools/instancer");
    const { createInstanceAnchor } = await import("../../src/instancer.js");
    const set = createInstanceSet({} as never, { capacity: 1 });
    const id = set.create({ position: [2, 3, 4] });
    const anchor = createInstanceAnchor(set, id, {
      preset: "top",
      localBounds: { minimum: [-1, -2, -1], maximum: [1, 2, 1] }
    });
    const out = new Float32Array(3);
    anchor.resolve(out);
    expect(Array.from(out)).toEqual([2, 5, 4]);
  });
});
