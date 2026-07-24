import { beforeEach, describe, expect, it, vi } from "vitest";
import { FakeBackend, fakeCanvas } from "./fake-backend.js";

vi.mock("@babylonjs/lite", () => ({
  getViewProjectionMatrix: vi.fn(() => new Float32Array([
    1, 0, 0, 0,
    0, 1, 0, 0,
    0, 0, 1, 0,
    0, 0, 0, 1
  ])),
  resolveCameraViewport: vi.fn((camera, width, height) => {
    const viewport = camera.viewport ?? { x: 0, y: 0, width: 1, height: 1 };
    return {
      x: viewport.x * width,
      y: (1 - viewport.y - viewport.height) * height,
      width: viewport.width * width,
      height: viewport.height * height
    };
  }),
  getCameraPosition: vi.fn(() => ({ x: 0, y: 0, z: 0 }))
}));

describe("annotation core", () => {
  beforeEach(() => vi.resetModules());

  it("copies world anchors and updates labels deterministically", async () => {
    const api = await import("../../src/index.js");
    const backend = new FakeBackend();
    const position = [0, 0, 0.5] as [number, number, number];
    const layer = api.createAnnotationLayer({
      scene: {} as never,
      camera: {} as never,
      canvas: fakeCanvas(),
      backend
    });
    const label = api.createLabel(layer, { anchor: { kind: "world", position }, text: "Pump" });
    position[0] = 1;
    api.updateAnnotationLayer(layer);

    expect(api.getAnnotationSnapshot(label).screenPosition).toEqual({ x: 50, y: 50 });
    expect(backend.resources[0]?.update?.text).toBe("Pump");
  });

  it("resolves local mesh points and world-space presets", async () => {
    const api = await import("../../src/index.js");
    const backend = new FakeBackend();
    const layer = api.createAnnotationLayer({
      scene: {} as never,
      camera: {} as never,
      canvas: fakeCanvas(),
      backend
    });
    const meshState = {
      visible: true,
      worldMatrix: new Float32Array([
        1, 0, 0, 0,
        0, 1, 0, 0,
        0, 0, 1, 0,
        0.5, 0, 0, 1
      ]),
      boundMin: [-1, -1, -1],
      boundMax: [1, 1, 1]
    };
    const mesh = meshState as never;
    const point = api.createLabel(layer, {
      anchor: { kind: "mesh", mesh, point: [0, 0, 0.5] },
      text: "point"
    });
    const top = api.createLabel(layer, {
      anchor: { kind: "mesh", mesh, preset: "top" },
      text: "top",
      hideWhenOffscreen: false
    });
    api.updateAnnotationLayer(layer);

    expect(api.getAnnotationSnapshot(point).worldPosition).toEqual([0.5, 0, 0.5]);
    expect(api.getAnnotationSnapshot(top).worldPosition).toEqual([0, 1, 0]);
    meshState.visible = false;
    api.updateAnnotationLayer(layer);
    expect(api.getAnnotationSnapshot(point).hiddenReason).toBe("target-hidden");
  });

  it("applies visibility precedence, distance limits, and viewport clamping", async () => {
    const api = await import("../../src/index.js");
    const backend = new FakeBackend();
    const layer = api.createAnnotationLayer({
      scene: {} as never,
      camera: {} as never,
      canvas: fakeCanvas(),
      backend,
      viewportPadding: 5
    });
    const clamped = api.createLabel(layer, {
      anchor: { kind: "world", position: [2, 0, 0.5] },
      text: "edge",
      clampToViewport: true
    });
    const distant = api.createLabel(layer, {
      anchor: { kind: "world", position: [0, 0, 0.5] },
      text: "near",
      minDistance: 2
    });
    api.updateAnnotationLayer(layer);

    expect(api.getAnnotationSnapshot(clamped).screenPosition?.x).toBe(85);
    expect(api.getAnnotationSnapshot(clamped).unclampedScreenPosition?.x).toBe(150);
    expect(api.getAnnotationSnapshot(distant).hiddenReason).toBe("distance");
    api.setAnnotationVisible(clamped, false);
    api.updateAnnotationLayer(layer);
    expect(api.getAnnotationSnapshot(clamped).requestedVisible).toBe(false);
  });

  it("hides unavailable resolver anchors and restores them without replacing the handle", async () => {
    const api = await import("../../src/index.js");
    const backend = new FakeBackend();
    let available = false;
    const layer = api.createAnnotationLayer({
      scene: {} as never,
      camera: {} as never,
      canvas: fakeCanvas(),
      backend
    });
    const label = api.createLabel(layer, {
      anchor: {
        kind: "resolver",
        resolve(out) {
          if (!available) return { available: false, targetVisible: false };
          out.set([0, 0, 0.5]);
          return { available: true, targetVisible: true, position: out };
        }
      },
      text: "stable"
    });
    api.updateAnnotationLayer(layer);
    expect(api.getAnnotationSnapshot(label).hiddenReason).toBe("anchor-unavailable");
    available = true;
    api.updateAnnotationLayer(layer);
    expect(api.getAnnotationSnapshot(label).rendered).toBe(true);
  });

  it("refreshes callback text only when invalidated", async () => {
    const api = await import("../../src/index.js");
    const backend = new FakeBackend();
    let value = 1;
    const layer = api.createAnnotationLayer({
      scene: {} as never,
      camera: {} as never,
      canvas: fakeCanvas(),
      backend
    });
    const label = api.createLabel(layer, {
      anchor: { kind: "world", position: [0, 0, 0.5] },
      text: () => String(value)
    });
    api.updateAnnotationLayer(layer);
    value = 2;
    api.updateAnnotationLayer(layer);
    expect(backend.resources[0]?.update?.text).toBe("1");
    expect(backend.resources[0]?.update?.definitionChanged).toBe(false);
    api.invalidateAnnotation(label);
    api.updateAnnotationLayer(layer);
    expect(backend.resources[0]?.update?.text).toBe("2");
    expect(backend.resources[0]?.update?.definitionChanged).toBe(true);
  });

  it("cancels its optional RAF driver on disposal", async () => {
    const request = vi.fn(() => 42);
    const cancel = vi.fn();
    vi.stubGlobal("requestAnimationFrame", request);
    vi.stubGlobal("cancelAnimationFrame", cancel);
    const api = await import("../../src/index.js");
    const layer = api.createAnnotationLayer({
      scene: {} as never,
      camera: {} as never,
      canvas: fakeCanvas(),
      backend: new FakeBackend(),
      updateMode: "raf"
    });
    expect(request).toHaveBeenCalledOnce();
    api.disposeAnnotationLayer(layer);
    expect(cancel).toHaveBeenCalledWith(42);
    vi.unstubAllGlobals();
  });

  it("disconnects its owned resize observer on disposal", async () => {
    const observe = vi.fn();
    const disconnect = vi.fn();
    vi.stubGlobal("ResizeObserver", class {
      observe = observe;
      disconnect = disconnect;
    });
    const api = await import("../../src/index.js");
    const canvas = fakeCanvas();
    const layer = api.createAnnotationLayer({
      scene: {} as never,
      camera: {} as never,
      canvas,
      backend: new FakeBackend()
    });
    expect(observe).toHaveBeenCalledWith(canvas);
    api.disposeAnnotationLayer(layer);
    expect(disconnect).toHaveBeenCalledOnce();
    vi.unstubAllGlobals();
  });

  it("disposes resources idempotently and rejects later use", async () => {
    const api = await import("../../src/index.js");
    const backend = new FakeBackend();
    const layer = api.createAnnotationLayer({
      scene: {} as never,
      camera: {} as never,
      canvas: fakeCanvas(),
      backend
    });
    const marker = api.createMarker(layer, {
      anchor: { kind: "world", position: [0, 0, 0.5] },
      shape: "ring"
    });
    api.disposeAnnotation(marker);
    api.disposeAnnotation(marker);
    expect(() => api.getAnnotationSnapshot(marker)).toThrow(/disposed/);
    api.disposeAnnotationLayer(layer);
    api.disposeAnnotationLayer(layer);
    expect(backend.disposed).toBe(true);
    expect(() => api.updateAnnotationLayer(layer)).toThrow(/disposed/);
  });
});
