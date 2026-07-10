import { beforeEach, describe, expect, it, vi } from "vitest";

const handle = {
  clips: {
    Swim: { fromRow: 0, frameCount: 10, fps: 20 },
    Turn: { fromRow: 20, frameCount: 5, fps: 10 }
  },
  play: vi.fn(),
  update: vi.fn(),
  setInstances: vi.fn()
};

vi.mock("@babylonjs/lite", () => ({
  bakeVat: vi.fn(() => ({ clips: handle.clips })),
  attachVat: vi.fn(() => handle),
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
  setThinInstanceColor: vi.fn(),
  flushThinInstances: vi.fn(),
  invalidateRenderBundles: vi.fn(),
  enableThinInstanceGpuCulling: vi.fn()
}));

describe("VatInstanceSet", () => {
  beforeEach(() => {
    vi.resetModules();
    handle.play.mockClear();
    handle.update.mockClear();
    handle.setInstances.mockClear();
  });

  it("keeps per-id playback params aligned after remove swaps slots", async () => {
    const { createVatInstanceSet } = await import("../src/vat-instance-set.js");
    const vat = createVatInstanceSet<{ label: string }>({} as never, {} as never, [] as never, { capacity: 4 });
    const a = vat.create({ metadata: { label: "a" }, clip: "Swim", offset: 1, fps: 21 });
    const b = vat.create({ metadata: { label: "b" }, clip: "Turn", offset: 2, fps: 11 });
    const c = vat.create({ metadata: { label: "c" }, clip: "Turn", offset: 3, fps: 12 });

    expect(vat.remove(b)).toBe(true);
    vat.syncInstances();

    expect(vat.set.has(a)).toBe(true);
    expect(vat.set.has(b)).toBe(false);
    expect(vat.set.has(c)).toBe(true);

    const params = handle.setInstances.mock.lastCall?.[0] as Float32Array;
    const aSlot = vat.set.getSlot(a) ?? -1;
    const cSlot = vat.set.getSlot(c) ?? -1;

    expect(Array.from(params.slice(aSlot * 4, aSlot * 4 + 4))).toEqual([0, 9, 1, 21]);
    expect(Array.from(params.slice(cSlot * 4, cSlot * 4 + 4))).toEqual([20, 24, 3, 12]);
  });

  it("supports shared clip defaults and per-id clip overrides", async () => {
    const { createVatInstanceSet } = await import("../src/vat-instance-set.js");
    const vat = createVatInstanceSet({} as never, {} as never, [] as never, { capacity: 2, clip: "Swim" });
    const inherited = vat.create();
    const overridden = vat.create({ clip: "Turn" });

    expect(vat.getClip(inherited)).toBe("Swim");
    expect(vat.getClip(overridden)).toBe("Turn");
    expect(vat.play("Turn")).toBe(true);
    expect(vat.getClip(inherited)).toBe("Turn");
    expect(vat.setClip(overridden, undefined)).toBe(true);
    expect(vat.getClip(overridden)).toBe("Turn");
    expect(vat.setClip(overridden, "Missing")).toBe(false);
  });

  it("exposes common instance-set operations directly", async () => {
    const { createVatInstanceSet } = await import("../src/vat-instance-set.js");
    const { toInstanceId } = await import("../src/types.js");
    const vat = createVatInstanceSet<{ label: string; selected: boolean }>(
      {} as never,
      {} as never,
      [] as never,
      { capacity: 4, colors: true }
    );
    const [a, b] = vat.createMany([
      { transform: { position: [1, 2, 3], scale: 1 }, metadata: { label: "a", selected: false } },
      { transform: { position: [4, 5, 6], scale: 1 }, metadata: { label: "b", selected: true } }
    ]);
    const missing = toInstanceId(999);

    expect(vat.count).toBe(2);
    expect(vat.has(a!)).toBe(true);
    expect(vat.getIdForSlot(vat.getSlot(b!) ?? -1)).toBe(b);
    expect(Array.from(vat.ids()).sort()).toEqual([a, b].sort());
    expect(vat.findByMetadata((metadata) => metadata.selected)).toBe(b);

    vat.setPosition(a!, [7, 8, 9]);
    vat.translate(a!, [1, -2, 3]);
    vat.setScale(a!, [2, 3, 4]);
    vat.setColor(a!, [1, 0, 0, 1]);
    vat.updateMetadata(a!, (metadata) => metadata && { ...metadata, selected: true });

    const matrix = vat.getMatrix(a!);
    expect(Array.from(vat.getPosition(a!))).toEqual([8, 6, 12]);
    expect(matrix[0]).toBe(2);
    expect(matrix[5]).toBe(3);
    expect(matrix[10]).toBe(4);
    expect(vat.getMetadata(a!)?.selected).toBe(true);
    expect(Array.from(vat.getColor(a!))).toEqual([1, 0, 0, 1]);

    expect(vat.trySetVisible(missing, false)).toBe(false);
    expect(vat.getMatrixOrUndefined(missing)).toBeUndefined();
  });

  it("syncs playback after direct visibility and bulk removal wrappers", async () => {
    const { createVatInstanceSet } = await import("../src/vat-instance-set.js");
    const vat = createVatInstanceSet<{ label: string }>({} as never, {} as never, [] as never, {
      capacity: 4,
      visibleStrategy: "active-count"
    });
    const [a, b, c] = vat.createMany([
      { metadata: { label: "a" }, clip: "Swim", offset: 1, fps: 20 },
      { metadata: { label: "b" }, clip: "Turn", offset: 2, fps: 10 },
      { metadata: { label: "c" }, clip: "Swim", offset: 3, fps: 21 }
    ]);

    handle.setInstances.mockClear();
    vat.setVisible(b!, false);

    expect(vat.getVisible(b!)).toBe(false);
    expect(handle.setInstances).toHaveBeenCalled();

    handle.setInstances.mockClear();
    expect(vat.removeMany([a!, c!])).toBe(2);
    expect(vat.has(a!)).toBe(false);
    expect(vat.has(c!)).toBe(false);
    expect(handle.setInstances).toHaveBeenCalled();
  });

  it("does not resync playback for matrix-only batches", async () => {
    const { createVatInstanceSet } = await import("../src/vat-instance-set.js");
    const vat = createVatInstanceSet({} as never, {} as never, [] as never, { capacity: 2 });
    const id = vat.create();

    handle.setInstances.mockClear();
    vat.batch((writer) => {
      writer.setMatrix(id, new Float32Array(16) as never);
    });

    expect(handle.setInstances).not.toHaveBeenCalled();
  });

  it("resyncs playback when batch visibility can change slots", async () => {
    const { createVatInstanceSet } = await import("../src/vat-instance-set.js");
    const vat = createVatInstanceSet({} as never, {} as never, [] as never, {
      capacity: 2,
      visibleStrategy: "active-count"
    });
    const id = vat.create();

    handle.setInstances.mockClear();
    vat.batch((writer) => {
      writer.setVisible(id, false);
    });

    expect(handle.setInstances).toHaveBeenCalled();
  });
});
