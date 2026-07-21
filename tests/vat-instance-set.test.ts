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

    expect(Array.from(params.slice(aSlot * 4, aSlot * 4 + 4))).toEqual([0, 9, 21, 21]);
    expect(Array.from(params.slice(cSlot * 4, cSlot * 4 + 4))).toEqual([20, 24, 36, 12]);
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

  it("coalesces createMany playback uploads into one complete parameter update", async () => {
    const { createVatInstanceSet } = await import("../src/vat-instance-set.js");
    const vat = createVatInstanceSet({} as never, {} as never, [] as never, { capacity: 4, clip: "Swim" });

    vat.createMany([{ offset: 1 }, { clip: "Turn", offset: 2 }, { offset: 3 }]);

    expect(handle.setInstances).toHaveBeenCalledTimes(1);
    expect(Array.from(handle.setInstances.mock.lastCall?.[0] as Float32Array)).toEqual([
      0, 9, 20, 20,
      20, 24, 20, 10,
      0, 9, 60, 20
    ]);
  });

  it("coalesces multiple playback edits into one upload", async () => {
    const { createVatInstanceSet } = await import("../src/vat-instance-set.js");
    const vat = createVatInstanceSet({} as never, {} as never, [] as never, { capacity: 4, clip: "Swim" });
    const [a, b] = vat.createMany([{}, {}]);
    handle.setInstances.mockClear();

    vat.batchPlayback(() => {
      vat.setClip(a!, "Turn");
      vat.setPhaseOffset(a!, 0.5);
      vat.batchPlayback(() => {
        vat.setClip(b!, "Turn");
        vat.setFps(b!, 15);
      });
    });

    expect(handle.setInstances).toHaveBeenCalledTimes(1);
  });

  it("updates playback atomically and skips identical payloads", async () => {
    const { createVatInstanceSet } = await import("../src/vat-instance-set.js");
    const vat = createVatInstanceSet({} as never, {} as never, [] as never, { capacity: 3, clip: "Swim" });
    const [a, b] = vat.createMany([{}, {}]);
    handle.setInstances.mockClear();

    expect(vat.setPlayback(a!, { clip: "Turn", offset: 0.5, fps: 15 })).toBe(true);
    expect(handle.setInstances).toHaveBeenCalledTimes(1);
    const writes = vat.playbackStats.slotWrites;
    expect(vat.setPlayback(a!, { clip: "Turn", offset: 0.5, fps: 15 })).toBe(true);
    expect(handle.setInstances).toHaveBeenCalledTimes(1);
    expect(vat.playbackStats.slotWrites).toBe(writes);

    expect(vat.setPlaybackMany([
      { id: a!, offset: 1 },
      { id: b!, clip: "Turn", fps: 12 }
    ])).toBe(2);
    expect(handle.setInstances).toHaveBeenCalledTimes(2);
  });

  it("uploads only the visible prefix and reports exact backend bytes", async () => {
    const { createVatInstanceSet } = await import("../src/vat-instance-set.js");
    const vat = createVatInstanceSet({} as never, {} as never, [] as never, {
      capacity: 4,
      clip: "Swim",
      visibleStrategy: "active-count"
    });
    const ids = vat.createMany([{}, {}, {}, {}]);
    vat.setVisibleMany(ids.slice(1), false);
    handle.setInstances.mockClear();
    const callsBefore = vat.playbackStats.backendUploadCalls;
    const bytesBefore = vat.playbackStats.backendBytesUploaded;

    vat.setPhaseOffset(ids[0]!, 0.75);

    expect(handle.setInstances).toHaveBeenCalledTimes(1);
    expect(handle.setInstances.mock.lastCall?.[0]).toHaveLength(4);
    expect(vat.playbackStats.backendUploadCalls - callsBefore).toBe(1);
    expect(vat.playbackStats.backendBytesUploaded - bytesBefore).toBe(4 * Float32Array.BYTES_PER_ELEMENT);

    handle.setInstances.mockClear();
    vat.setPhaseOffset(ids[1]!, 1.25);
    expect(handle.setInstances).not.toHaveBeenCalled();
    vat.setVisible(ids[1]!, true);
    expect(handle.setInstances).toHaveBeenCalledTimes(1);
    expect(handle.setInstances.mock.lastCall?.[0]).toHaveLength(8);
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
    expect(vat.visibleCount).toBe(0);
    expect(handle.setInstances).not.toHaveBeenCalled();
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

  it("avoids playback upload when batch visibility does not move a slot", async () => {
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

    expect(handle.setInstances).not.toHaveBeenCalled();
  });

  it("exposes the same frame selection used by VAT playback", async () => {
    const { createVatInstanceSet } = await import("../src/vat-instance-set.js");
    const vat = createVatInstanceSet({} as never, {} as never, [] as never, { capacity: 1, clip: "Swim" });
    const id = vat.create({ offset: 0.5, fps: 20 });

    vat.update(0.25);
    const sample = vat.getPlaybackSample(id!);

    expect(sample).toMatchObject({ clip: "Swim", timeSeconds: 0.25, offsetSeconds: 0.5, fps: 20, frame: 5 });
    expect(sample?.nextFrame).toBe(6);
  });

  it("loads a validated portable asset through an explicit public runtime boundary", async () => {
    const { createVatInstanceSetFromAsset } = await import("../src/vat-instance-set.js");
    const frameData = new Float32Array(16);
    const asset = {
      version: 1 as const,
      encoding: "lite-matrix-rgba32float" as const,
      basis: "gltf-rh-model-world" as const,
      boneCount: 1,
      frameCount: 1,
      texture: { width: 4, height: 1, format: "rgba32float" as const },
      clips: { Swim: { fromRow: 0, frameCount: 1, fps: 20 } },
      frameData
    };
    expect(() => createVatInstanceSetFromAsset({} as never, {} as never, asset)).toThrow(/public Babylon Lite/i);
    const runtime = { createBakeResult: vi.fn(() => ({ clips: asset.clips })) };
    const vat = createVatInstanceSetFromAsset({} as never, {} as never, asset, { capacity: 1 }, runtime as never);
    expect(vat.create()).toBeDefined();
    expect(vat.asset).toBe(asset);
    expect(runtime.createBakeResult).toHaveBeenCalled();
  });
});
