import { beforeEach, describe, expect, it, vi } from "vitest";

const handles: Array<{ clips: Record<string, { fromRow: number; frameCount: number; fps: number }>; play: ReturnType<typeof vi.fn>; update: ReturnType<typeof vi.fn>; setInstances: ReturnType<typeof vi.fn> }> = [];

vi.mock("@babylonjs/lite", () => ({
  bakeVat: vi.fn(() => ({ clips: { Walk: { fromRow: 0, frameCount: 10, fps: 20 }, Run: { fromRow: 20, frameCount: 5, fps: 10 } } })),
  attachVat: vi.fn(() => {
    const handle = {
      clips: { Walk: { fromRow: 0, frameCount: 10, fps: 20 }, Run: { fromRow: 20, frameCount: 5, fps: 10 } },
      play: vi.fn(),
      update: vi.fn(),
      setInstances: vi.fn()
    };
    handles.push(handle);
    return handle;
  }),
  setThinInstances: vi.fn((mesh, matrices, count) => { mesh.thinInstances = { matrices, count }; }),
  setThinInstanceCount: vi.fn((mesh, count) => { mesh.thinInstances.count = count; }),
  setThinInstanceDrawCount: vi.fn((mesh, count) => { mesh.thinInstances.count = count; }),
  enableThinInstanceDynamicDrawCount: vi.fn(),
  setThinInstanceMatrix: vi.fn((mesh, index, matrix) => { mesh.thinInstances.matrices.set(matrix, index * 16); }),
  setThinInstanceColors: vi.fn(),
  setThinInstanceColor: vi.fn(),
  flushThinInstances: vi.fn(),
  invalidateRenderBundles: vi.fn(),
  enableThinInstanceGpuCulling: vi.fn()
}));

describe("VatCharacterSet", () => {
  beforeEach(() => {
    vi.resetModules();
    handles.length = 0;
  });

  it("keeps secondary skinned meshes on the primary instance's clip and playback settings", async () => {
    const { createVatCharacterSet, findSkinnedMeshes } = await import("../src/vat-character-set.js");
    const device = {
      queue: {
        submit: vi.fn(),
        onSubmittedWorkDone: vi.fn(() => Promise.resolve())
      }
    };
    const skeleton = { boneTexture: { destroy: vi.fn() } };
    const primaryMesh = { skeleton, children: [] };
    const secondaryMesh = { skeleton, children: [] };
    const root = { children: [primaryMesh, secondaryMesh] };
    expect(findSkinnedMeshes(root as never)).toEqual([primaryMesh, secondaryMesh]);
    const character = createVatCharacterSet({ _device: device } as never, root as never, [{}] as never, { capacity: 2 });
    const id = character.create({ offset: 0.5 });

    expect(handles).toHaveLength(2);
    expect(Array.from(handles[1]!.setInstances.mock.lastCall?.[0] as Float32Array)).toEqual([0, 9, 10, 20]);

    expect(character.play("Run")).toBe(true);
    expect(handles[1]!.play).toHaveBeenLastCalledWith("Run");
    expect(Array.from(handles[1]!.setInstances.mock.lastCall?.[0] as Float32Array)).toEqual([20, 24, 5, 10]);

    character.setFps(id, 15);
    expect(Array.from(handles[1]!.setInstances.mock.lastCall?.[0] as Float32Array)).toEqual([20, 24, 7.5, 15]);
    character.update(0.25);
    expect(handles[0]!.update).toHaveBeenCalledWith(0.25);
    expect(handles[1]!.update).toHaveBeenCalledWith(0.25);
  });

  it("coalesces playback uploads when creating multiple coordinated characters", async () => {
    const { createVatCharacterSet } = await import("../src/vat-character-set.js");
    const device = { queue: { submit: vi.fn(), onSubmittedWorkDone: vi.fn(() => Promise.resolve()) } };
    const primaryMesh = { skeleton: { boneTexture: { destroy: vi.fn() } }, children: [] };
    const secondaryMesh = { skeleton: { boneTexture: { destroy: vi.fn() } }, children: [] };
    const root = { children: [primaryMesh, secondaryMesh] };
    const character = createVatCharacterSet({ _device: device } as never, root as never, [{}] as never, { capacity: 4 });

    character.createMany([{ offset: 0 }, { offset: 0.5 }, { offset: 1 }]);

    expect(handles).toHaveLength(2);
    expect(handles[0]!.setInstances).toHaveBeenCalledTimes(1);
    expect(handles[1]!.setInstances).toHaveBeenCalledTimes(1);
  });

  it("coalesces bulk playback edits into one upload per mesh part", async () => {
    const { createVatCharacterSet } = await import("../src/vat-character-set.js");
    const device = { queue: { submit: vi.fn(), onSubmittedWorkDone: vi.fn(() => Promise.resolve()) } };
    const skeleton = { boneTexture: { destroy: vi.fn() } };
    const root = { children: [{ skeleton, children: [] }, { skeleton, children: [] }] };
    const character = createVatCharacterSet({ _device: device } as never, root as never, [{}] as never, { capacity: 4 });
    const ids = character.createMany([{}, {}, {}]);
    for (const vatHandle of handles) vatHandle.setInstances.mockClear();

    character.batchPlayback(() => {
      character.batchPlayback(() => {
        for (const id of ids) {
          character.setClip(id, "Run");
          character.setPhaseOffset(id, 0.25);
        }
      });
    });

    expect(handles[0]!.setInstances).toHaveBeenCalledTimes(1);
    expect(handles[1]!.setInstances).toHaveBeenCalledTimes(1);
  });

  it("bulk-updates visibility with one visible-prefix upload per mesh", async () => {
    const { createVatCharacterSet } = await import("../src/vat-character-set.js");
    const device = { queue: { submit: vi.fn(), onSubmittedWorkDone: vi.fn(() => Promise.resolve()) } };
    const skeleton = { boneTexture: { destroy: vi.fn() } };
    const root = { children: [{ skeleton, children: [] }, { skeleton, children: [] }] };
    const character = createVatCharacterSet({ _device: device } as never, root as never, [{}] as never, {
      capacity: 4,
      visibleStrategy: "active-count"
    });
    const ids = character.createMany([{}, {}, {}, {}]);
    for (const vatHandle of handles) vatHandle.setInstances.mockClear();

    character.setVisibleMany(ids.slice(1), false);

    expect(character.visibleCount).toBe(1);
    expect(handles[0]!.setInstances).not.toHaveBeenCalled();
    expect(handles[1]!.setInstances).not.toHaveBeenCalled();

    character.setVisibleMany([ids[1]!], true);

    expect(character.visibleCount).toBe(2);
    expect(handles[0]!.setInstances).toHaveBeenCalledTimes(1);
    expect(handles[1]!.setInstances).toHaveBeenCalledTimes(1);
    expect(handles[0]!.setInstances.mock.lastCall?.[0]).toHaveLength(8);
    expect(handles[1]!.setInstances.mock.lastCall?.[0]).toHaveLength(8);
  });
});
