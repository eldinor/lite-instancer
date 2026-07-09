import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@babylonjs/lite", () => ({
  setThinInstances: vi.fn((mesh, matrices, count) => {
    mesh.thinInstances = { matrices, count };
  }),
  setThinInstanceCount: vi.fn((mesh, count) => {
    mesh.thinInstances.count = count;
  }),
  setThinInstanceMatrix: vi.fn((mesh, index, matrix) => {
    mesh.thinInstances.matrices.set(matrix, index * 16);
  }),
  setThinInstanceColors: vi.fn((mesh, colors) => {
    mesh.thinInstances.colors = colors;
  }),
  setThinInstanceColor: vi.fn((mesh, index, r, g, b, a) => {
    const colors = mesh.thinInstances.colors;
    colors[index * 4] = r;
    colors[index * 4 + 1] = g;
    colors[index * 4 + 2] = b;
    colors[index * 4 + 3] = a;
  }),
  flushThinInstances: vi.fn(),
  invalidateRenderBundles: vi.fn(),
  enableThinInstanceGpuCulling: vi.fn()
}));

describe("InstanceSet", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("keeps stable ids after remove swap", async () => {
    const { createInstanceSet } = await import("../src/instance-set.js");
    const mesh = {} as never;
    const instances = createInstanceSet(mesh, { capacity: 4 });
    const a = instances.create({ position: [0, 0, 0] });
    const b = instances.create({ position: [1, 0, 0] });
    const c = instances.create({ position: [2, 0, 0] });

    expect(instances.remove(b)).toBe(true);
    expect(instances.has(a)).toBe(true);
    expect(instances.has(c)).toBe(true);
    expect(instances.count).toBe(2);
    expect(instances.getIdForSlot(instances.getSlot(c) ?? -1)).toBe(c);
  });

  it("partitions hidden active-count instances outside the visible range", async () => {
    const { createInstanceSet } = await import("../src/instance-set.js");
    const mesh = {} as never;
    const instances = createInstanceSet(mesh, { capacity: 4, visibleStrategy: "active-count" });
    const a = instances.create();
    const b = instances.create();
    const c = instances.create();

    instances.setVisible(b, false);

    expect(instances.count).toBe(3);
    expect(instances.visibleCount).toBe(2);
    expect(instances.getVisible(a)).toBe(true);
    expect(instances.getVisible(b)).toBe(false);
    expect(instances.getVisible(c)).toBe(true);
  });

  it("handles bulk visibility toggles while slots are moving", async () => {
    const { createInstanceSet } = await import("../src/instance-set.js");
    const mesh = {} as never;
    const instances = createInstanceSet<{ group: "a" | "b" }>(mesh, { capacity: 12, visibleStrategy: "active-count" });
    const ids = Array.from({ length: 10 }, (_, index) => instances.create(undefined, { group: index % 2 === 0 ? "a" : "b" }));

    for (const id of ids) {
      if (instances.getMetadata(id)?.group === "a") {
        instances.setVisible(id, false);
      }
    }

    expect(instances.visibleCount).toBe(5);
    for (const id of ids) {
      expect(instances.getVisible(id)).toBe(instances.getMetadata(id)?.group === "b");
    }

    for (const id of ids) {
      if (instances.getMetadata(id)?.group === "a") {
        instances.setVisible(id, true);
      }
    }

    expect(instances.visibleCount).toBe(10);
    expect(ids.every((id) => instances.getVisible(id))).toBe(true);
  });
});
