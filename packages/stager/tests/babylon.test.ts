const lite = vi.hoisted(() => ({
  attachControl: vi.fn((_camera: unknown, _canvas: unknown, _scene: unknown, _options?: unknown) => vi.fn()),
  attachFreeControl: vi.fn((_camera: unknown, _canvas: unknown, _scene: unknown) => vi.fn()),
  attachGeospatialControls: vi.fn((_camera: unknown, _canvas: unknown, _scene: unknown, _options?: unknown) => vi.fn()),
  disposeScene: vi.fn((_scene: unknown) => undefined),
  registerScene: vi.fn(async (_scene: unknown) => undefined),
  unregisterScene: vi.fn((_scene: unknown) => undefined)
}));

vi.mock("@babylonjs/lite", () => lite);

import {
  arcRotateCameraControls,
  createBabylonStageHost,
  defineBabylonStage,
  freeCameraControls,
  geospatialCameraControls,
  type BabylonCameraControls
} from "../src/babylon.js";
import {
  beginStageNavigation,
  createStageManager,
  disposeStageManager,
  navigateToStage
} from "../src/index.js";
import type {
  ArcRotateCamera,
  FreeCamera,
  GeospatialCamera,
  SceneContext
} from "@babylonjs/lite";

describe("Babylon stage adapter", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    lite.registerScene.mockImplementation(async (_scene: unknown) => undefined);
    lite.unregisterScene.mockImplementation((_scene: unknown) => undefined);
  });

  it("performs exclusive scene handoffs and leases controls only to the active stage", async () => {
    const events: string[] = [];
    const canvas = {} as HTMLCanvasElement;
    const firstScene = { name: "first" } as unknown as SceneContext;
    const secondScene = { name: "second" } as unknown as SceneContext;
    lite.registerScene.mockImplementation(async (value: unknown) => {
      const scene = value as SceneContext;
      events.push(`register:${scene === firstScene ? "first" : "second"}`);
    });
    lite.unregisterScene.mockImplementation((value: unknown) => {
      const scene = value as SceneContext;
      events.push(`unregister:${scene === firstScene ? "first" : "second"}`);
    });
    const controls = (name: string): BabylonCameraControls => ({
      attach() {
        events.push(`attach:${name}`);
        return () => events.push(`detach:${name}`);
      }
    });

    const manager = createStageManager();
    const host = createBabylonStageHost({ canvas });
    defineBabylonStage(manager, host, {
      id: "first",
      load: () => ({ scene: firstScene, controls: controls("first"), data: "first-data" })
    });
    defineBabylonStage(manager, host, {
      id: "second",
      load: () => ({ scene: secondScene, controls: controls("second"), data: "second-data" })
    });

    await navigateToStage(manager, "first");
    await navigateToStage(manager, "second");

    expect(events).toEqual([
      "register:first",
      "attach:first",
      "detach:first",
      "unregister:first",
      "register:second",
      "attach:second"
    ]);

    await disposeStageManager(manager);
    expect(events.slice(-2)).toEqual(["detach:second", "unregister:second"]);
    expect(lite.disposeScene).toHaveBeenCalledWith(firstScene);
    expect(lite.disposeScene).toHaveBeenCalledWith(secondScene);
  });

  it("disposes a scene returned after its operation became stale without registering it", async () => {
    const canvas = {} as HTMLCanvasElement;
    const staleScene = { id: "stale" } as unknown as SceneContext;
    const currentScene = { id: "current" } as unknown as SceneContext;
    let resolveStale!: () => void;
    const staleReady = new Promise<void>((resolve) => {
      resolveStale = resolve;
    });
    const manager = createStageManager();
    const host = createBabylonStageHost({ canvas });
    defineBabylonStage(manager, host, {
      id: "stale",
      async load() {
        await staleReady;
        return { scene: staleScene, data: null };
      }
    });
    defineBabylonStage(manager, host, {
      id: "current",
      load: () => ({ scene: currentScene, data: null })
    });

    const stale = beginStageNavigation(manager, "stale");
    await Promise.resolve();
    const current = navigateToStage(manager, "current");
    resolveStale();
    await current;
    await expect(stale.promise).rejects.toMatchObject({ name: "AbortError" });

    expect(lite.registerScene).not.toHaveBeenCalledWith(staleScene);
    expect(lite.disposeScene).toHaveBeenCalledWith(staleScene);
  });

  it("maps every built-in camera type to its matching Lite control attachment", () => {
    const canvas = {} as HTMLCanvasElement;
    const scene = {} as SceneContext;
    const arc = {} as ArcRotateCamera;
    const free = {} as FreeCamera;
    const geo = {} as GeospatialCamera;
    const arcOptions = { shouldHandlePointerDown: () => true };
    const geoOptions = { zoomToCursor: false };

    arcRotateCameraControls(arc, arcOptions).attach(canvas, scene);
    freeCameraControls(free).attach(canvas, scene);
    geospatialCameraControls(geo, geoOptions).attach(canvas, scene);

    expect(lite.attachControl).toHaveBeenCalledWith(arc, canvas, scene, arcOptions);
    expect(lite.attachFreeControl).toHaveBeenCalledWith(free, canvas, scene);
    expect(lite.attachGeospatialControls).toHaveBeenCalledWith(geo, canvas, scene, geoOptions);
  });

  it("restores the outgoing scene and controls when incoming registration fails", async () => {
    const canvas = {} as HTMLCanvasElement;
    const firstScene = { id: "first" } as unknown as SceneContext;
    const brokenScene = { id: "broken" } as unknown as SceneContext;
    const events: string[] = [];
    lite.registerScene.mockImplementation(async (value: unknown) => {
      const scene = value as SceneContext;
      const name = scene === firstScene ? "first" : "broken";
      events.push(`register:${name}`);
      if (scene === brokenScene) throw new Error("registration failed");
    });
    lite.unregisterScene.mockImplementation((value: unknown) => {
      events.push(`unregister:${value === firstScene ? "first" : "broken"}`);
    });
    const controls = (name: string): BabylonCameraControls => ({
      attach() {
        events.push(`attach:${name}`);
        return () => events.push(`detach:${name}`);
      }
    });
    const manager = createStageManager();
    const host = createBabylonStageHost({ canvas });
    defineBabylonStage(manager, host, {
      id: "first",
      load: () => ({ scene: firstScene, controls: controls("first"), data: null })
    });
    defineBabylonStage(manager, host, {
      id: "broken",
      load: () => ({ scene: brokenScene, controls: controls("broken"), data: null })
    });

    await navigateToStage(manager, "first");
    await expect(navigateToStage(manager, "broken")).rejects.toThrow("registration failed");

    expect(manager.activeStage?.id).toBe("first");
    expect(events).toEqual([
      "register:first",
      "attach:first",
      "detach:first",
      "unregister:first",
      "register:broken",
      "register:first",
      "attach:first"
    ]);
  });

  it("restores the outgoing scene when the incoming user enter hook fails", async () => {
    const canvas = {} as HTMLCanvasElement;
    const firstScene = { id: "first" } as unknown as SceneContext;
    const brokenScene = { id: "broken-enter" } as unknown as SceneContext;
    const events: string[] = [];
    lite.registerScene.mockImplementation(async (value: unknown) => {
      events.push(`register:${value === firstScene ? "first" : "broken"}`);
    });
    lite.unregisterScene.mockImplementation((value: unknown) => {
      events.push(`unregister:${value === firstScene ? "first" : "broken"}`);
    });
    const controls = (name: string): BabylonCameraControls => ({
      attach() {
        events.push(`attach:${name}`);
        return () => events.push(`detach:${name}`);
      }
    });
    const manager = createStageManager();
    const host = createBabylonStageHost({ canvas });
    defineBabylonStage(manager, host, {
      id: "first",
      load: () => ({ scene: firstScene, controls: controls("first"), data: null })
    });
    defineBabylonStage(manager, host, {
      id: "broken",
      load: () => ({ scene: brokenScene, controls: controls("broken"), data: null }),
      enter() {
        throw new Error("user enter failed");
      }
    });

    await navigateToStage(manager, "first");
    await expect(navigateToStage(manager, "broken")).rejects.toThrow("user enter failed");

    expect(manager.activeStage?.id).toBe("first");
    expect(events).toEqual([
      "register:first",
      "attach:first",
      "detach:first",
      "unregister:first",
      "register:broken",
      "attach:broken",
      "detach:broken",
      "unregister:broken",
      "register:first",
      "attach:first"
    ]);
  });

  it("restores the outgoing scene when incoming controls cannot attach", async () => {
    const canvas = {} as HTMLCanvasElement;
    const firstScene = { id: "first" } as unknown as SceneContext;
    const brokenScene = { id: "broken-controls" } as unknown as SceneContext;
    const events: string[] = [];
    lite.registerScene.mockImplementation(async (value: unknown) => {
      events.push(`register:${value === firstScene ? "first" : "broken"}`);
    });
    lite.unregisterScene.mockImplementation((value: unknown) => {
      events.push(`unregister:${value === firstScene ? "first" : "broken"}`);
    });
    const firstControls: BabylonCameraControls = {
      attach() {
        events.push("attach:first");
        return () => events.push("detach:first");
      }
    };
    const brokenControls: BabylonCameraControls = {
      attach() {
        events.push("attach:broken");
        throw new Error("controls failed");
      }
    };
    const manager = createStageManager();
    const host = createBabylonStageHost({ canvas });
    defineBabylonStage(manager, host, {
      id: "first",
      load: () => ({ scene: firstScene, controls: firstControls, data: null })
    });
    defineBabylonStage(manager, host, {
      id: "broken",
      load: () => ({ scene: brokenScene, controls: brokenControls, data: null })
    });

    await navigateToStage(manager, "first");
    await expect(navigateToStage(manager, "broken")).rejects.toThrow("controls failed");

    expect(manager.activeStage?.id).toBe("first");
    expect(events).toEqual([
      "register:first",
      "attach:first",
      "detach:first",
      "unregister:first",
      "register:broken",
      "attach:broken",
      "unregister:broken",
      "register:first",
      "attach:first"
    ]);
  });
});
