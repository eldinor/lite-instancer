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
});
