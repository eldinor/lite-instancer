import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  geometryDispose: vi.fn()
}));

vi.mock("@babylonjs/lite", () => ({
  GeometryTextureType: { SCREENSPACE_DEPTH: 6 },
  createGeometryRendererTask: vi.fn(() => ({
    name: "depth",
    engine: {},
    _passes: [],
    geometryScreenspaceDepthTexture: {
      _colorTexture: null,
      _colorView: null,
      _width: 0,
      _height: 0
    },
    record() {},
    execute() {
      return 0;
    },
    dispose: mocks.geometryDispose
  })),
  addTask: vi.fn((scene, task) => {
    scene._frameGraph._tasks.push(task);
  }),
  addTaskAfter: vi.fn((scene, task, after) => {
    const index = scene._frameGraph._tasks.indexOf(after);
    scene._frameGraph._tasks.splice(index + 1, 0, task);
  })
}));

describe("Babylon depth occlusion adapter", () => {
  it("registers two owned tasks and removes them during idempotent disposal", async () => {
    const { createBabylonDepthOcclusionProvider } = await import(
      "../../src/babylon-occlusion.js"
    );
    const scene = {
      _built: false,
      _frameGraph: { _tasks: [] },
      surface: { engine: { _device: {} } }
    };
    const provider = createBabylonDepthOcclusionProvider({
      scene: scene as never,
      camera: {} as never,
      canvas: {} as never
    });

    expect(scene._frameGraph._tasks).toHaveLength(2);
    expect(provider.getStats()).toEqual({
      lastQueryCount: 0,
      submittedQueries: 0,
      completedReadbacks: 0,
      droppedReadbacks: 0,
      inFlightReadbacks: 0,
      lastReadbackMs: 0,
      averageReadbackMs: 0
    });
    provider.update([]);
    expect(provider.getStats().lastQueryCount).toBe(0);
    provider.dispose();
    provider.dispose();
    expect(scene._frameGraph._tasks).toHaveLength(0);
    expect(mocks.geometryDispose).toHaveBeenCalledOnce();
  });

  it("validates hysteresis thresholds", async () => {
    const { createBabylonDepthOcclusionProvider } = await import(
      "../../src/babylon-occlusion.js"
    );
    expect(() =>
      createBabylonDepthOcclusionProvider({
        scene: {
          _built: false,
          _frameGraph: { _tasks: [] },
          surface: { engine: { _device: {} } }
        } as never,
        camera: {} as never,
        canvas: {} as never,
        enterHysteresis: 0
      })
    ).toThrow(/enter hysteresis/);
  });

  it("rejects creation after the scene frame graph has been built", async () => {
    const { createBabylonDepthOcclusionProvider } = await import(
      "../../src/babylon-occlusion.js"
    );
    expect(() =>
      createBabylonDepthOcclusionProvider({
        scene: {
          _built: true,
          _frameGraph: { _tasks: [] },
          surface: { engine: { _device: {} } }
        } as never,
        camera: {} as never,
        canvas: {} as never
      })
    ).toThrow(/before registerScene/);
  });
});
