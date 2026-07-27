import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  computeDispose: vi.fn()
}));

vi.mock("@babylonjs/lite", () => ({
  addTaskAfter: vi.fn((scene, task, after) => {
    task.dispose = mocks.computeDispose;
    const index = scene._frameGraph._tasks.indexOf(after);
    scene._frameGraph._tasks.splice(index + 1, 0, task);
  })
}));

function createScene() {
  const sceneTask = {
    name: "scene",
    _passes: [],
    _config: {
      rt: {
        _descriptor: { samples: 1 },
        _depthTexture: null,
        _depthView: null,
        _width: 0,
        _height: 0
      },
      depth: {
        _descriptor: { samples: 1 },
        _depthTexture: null,
        _depthView: null,
        _width: 0,
        _height: 0
      }
    }
  };
  return {
    _built: false,
    _frameGraph: { _tasks: [sceneTask] },
    surface: { engine: { _device: {} } }
  };
}

describe("Babylon depth occlusion adapter", () => {
  it("registers two owned tasks and removes them during idempotent disposal", async () => {
    const { createBabylonDepthOcclusionProvider } = await import(
      "../../src/babylon-occlusion.js"
    );
    const scene = createScene();
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
    expect(scene._frameGraph._tasks).toHaveLength(1);
    expect(mocks.computeDispose).toHaveBeenCalledOnce();
  });

  it("validates hysteresis thresholds", async () => {
    const { createBabylonDepthOcclusionProvider } = await import(
      "../../src/babylon-occlusion.js"
    );
    expect(() =>
      createBabylonDepthOcclusionProvider({
        scene: createScene() as never,
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
