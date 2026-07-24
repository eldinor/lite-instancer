import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
  AnnotationOcclusionProvider,
  AnnotationOcclusionRequest,
  AnnotationOcclusionState
} from "../../src/types.js";
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

  it("submits projected anchors to an occlusion provider and hides completed hits", async () => {
    const api = await import("../../src/index.js");
    const backend = new FakeBackend();
    const states = new Map<number, AnnotationOcclusionState>();
    let requests: readonly AnnotationOcclusionRequest[] = [];
    const dispose = vi.fn();
    const provider: AnnotationOcclusionProvider = {
      getResult(id) {
        return states.get(id as number) ?? "unknown";
      },
      update(next) {
        requests = next.map((request) => ({
          ...request,
          screenPosition: { ...request.screenPosition }
        }));
      },
      dispose
    };
    const layer = api.createAnnotationLayer({
      scene: {} as never,
      camera: {} as never,
      canvas: fakeCanvas(),
      backend,
      occlusionProvider: provider
    });
    const label = api.createLabel(layer, {
      anchor: { kind: "world", position: [0, 0, 0.5] },
      text: "occluded",
      occlusion: "hide",
      occlusionBias: 0.002
    });

    api.updateAnnotationLayer(layer);
    expect(api.getAnnotationSnapshot(label).rendered).toBe(true);
    expect(requests).toEqual([
      expect.objectContaining({
        id: label.id,
        screenPosition: { x: 50, y: 50 },
        depth: 0.5,
        bias: 0.002,
        revision: 0
      })
    ]);

    states.set(label.id as number, "occluded");
    api.updateAnnotationLayer(layer);
    expect(api.getAnnotationSnapshot(label)).toEqual(expect.objectContaining({
      rendered: false,
      occluded: true,
      hiddenReason: "occluded",
      worldPosition: [0, 0, 0.5],
      depth: 0.5
    }));

    api.updateLabel(label, {
      occlusion: "fade",
      occludedOpacity: 0.5,
      style: { opacity: 0.8 }
    });
    api.updateAnnotationLayer(layer);
    expect(api.getAnnotationSnapshot(label)).toEqual(expect.objectContaining({
      rendered: true,
      occluded: true,
      hiddenReason: "none"
    }));
    expect(backend.resources[0]?.update?.style.opacity).toBeCloseTo(0.4);

    states.set(label.id as number, "visible");
    api.updateAnnotationLayer(layer);
    expect(api.getAnnotationSnapshot(label).occluded).toBe(false);
    expect(backend.resources[0]?.update?.style.opacity).toBe(0.8);

    api.updateLabel(label, { occlusion: "none" });
    states.set(label.id as number, "occluded");
    api.updateAnnotationLayer(layer);
    expect(requests).toEqual([]);
    expect(api.getAnnotationSnapshot(label).occluded).toBe(false);
    expect(api.getAnnotationSnapshot(label).rendered).toBe(true);

    api.disposeAnnotationLayer(layer);
    expect(dispose).toHaveBeenCalledOnce();
  });

  it("rejects stale occlusion results after an anchor change", async () => {
    const api = await import("../../src/index.js");
    let completedRevision = 0;
    const provider: AnnotationOcclusionProvider = {
      getResult(_id, revision) {
        return revision === completedRevision ? "occluded" : "unknown";
      },
      update() {},
      dispose() {}
    };
    const layer = api.createAnnotationLayer({
      scene: {} as never,
      camera: {} as never,
      canvas: fakeCanvas(),
      backend: new FakeBackend(),
      occlusionProvider: provider
    });
    const label = api.createLabel(layer, {
      anchor: { kind: "world", position: [0, 0, 0.5] },
      text: "moving",
      hideWhenOccluded: true
    });
    api.updateAnnotationLayer(layer);
    expect(api.getAnnotationSnapshot(label).hiddenReason).toBe("occluded");

    api.setAnnotationAnchor(label, { kind: "world", position: [0.5, 0, 0.5] });
    api.updateAnnotationLayer(layer);
    expect(api.getAnnotationSnapshot(label).rendered).toBe(true);
    completedRevision = 1;
    api.updateAnnotationLayer(layer);
    expect(api.getAnnotationSnapshot(label).hiddenReason).toBe("occluded");
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

  it("hides colliding labels by z-index and restores them after separation", async () => {
    const api = await import("../../src/index.js");
    const backend = new FakeBackend();
    const layer = api.createAnnotationLayer({
      scene: {} as never,
      camera: {} as never,
      canvas: fakeCanvas(),
      backend
    });
    const lower = api.createLabel(layer, {
      anchor: { kind: "world", position: [0, 0, 0.5] },
      text: "lower",
      collision: "hide",
      zIndex: 1
    });
    const higher = api.createLabel(layer, {
      anchor: { kind: "world", position: [0, 0, 0.5] },
      text: "higher",
      collision: "hide",
      zIndex: 2
    });

    api.updateAnnotationLayer(layer);
    expect(api.getAnnotationSnapshot(higher).rendered).toBe(true);
    expect(api.getAnnotationSnapshot(lower).hiddenReason).toBe("collision");

    api.setAnnotationAnchor(higher, { kind: "world", position: [0.8, 0, 0.5] });
    api.updateAnnotationLayer(layer);
    expect(api.getAnnotationSnapshot(higher).rendered).toBe(true);
    expect(api.getAnnotationSnapshot(lower).rendered).toBe(true);
  });

  it("uses creation order for collision ties and treats always-visible labels as obstacles", async () => {
    const api = await import("../../src/index.js");
    const backend = new FakeBackend();
    const layer = api.createAnnotationLayer({
      scene: {} as never,
      camera: {} as never,
      canvas: fakeCanvas(),
      backend
    });
    const fixed = api.createLabel(layer, {
      anchor: { kind: "world", position: [-0.7, 0, 0.5] },
      text: "fixed"
    });
    const first = api.createLabel(layer, {
      anchor: { kind: "world", position: [0, 0, 0.5] },
      text: "first",
      collision: "hide"
    });
    const second = api.createLabel(layer, {
      anchor: { kind: "world", position: [0, 0, 0.5] },
      text: "second",
      collision: "hide"
    });
    const nearFixed = api.createLabel(layer, {
      anchor: { kind: "world", position: [-0.5, 0, 0.5] },
      text: "near fixed",
      collision: "hide",
      collisionPadding: 1
    });

    api.updateAnnotationLayer(layer);
    expect(api.getAnnotationSnapshot(fixed).rendered).toBe(true);
    expect(api.getAnnotationSnapshot(first).rendered).toBe(true);
    expect(api.getAnnotationSnapshot(second).hiddenReason).toBe("collision");
    expect(api.getAnnotationSnapshot(nearFixed).hiddenReason).toBe("collision");
  });

  it("validates collision padding on create and update", async () => {
    const api = await import("../../src/index.js");
    const layer = api.createAnnotationLayer({
      scene: {} as never,
      camera: {} as never,
      canvas: fakeCanvas(),
      backend: new FakeBackend()
    });
    expect(() => api.createLabel(layer, {
      anchor: { kind: "world", position: [0, 0, 0.5] },
      text: "invalid",
      collisionPadding: -1
    })).toThrow(/collision padding/);
    const label = api.createLabel(layer, {
      anchor: { kind: "world", position: [0, 0, 0.5] },
      text: "valid"
    });
    expect(() => api.updateLabel(label, { collisionPadding: Number.NaN })).toThrow(/collision padding/);
    expect(() => api.updateLabel(label, { collisionMaxShift: -1 })).toThrow(/maximum collision shift/);
    expect(() => api.updateLabel(label, { occlusionBias: -1 })).toThrow(/Occlusion bias/);
    expect(() => api.updateLabel(label, { occludedOpacity: 1.1 })).toThrow(/Occluded opacity/);
    expect(() => api.updateLabel(label, { occlusion: "dim" as never })).toThrow(/occlusion mode/);
  });

  it("shifts overlapping labels within the viewport and returns them to their anchor", async () => {
    const api = await import("../../src/index.js");
    const backend = new FakeBackend();
    const layer = api.createAnnotationLayer({
      scene: {} as never,
      camera: {} as never,
      canvas: fakeCanvas(),
      backend,
      viewportPadding: 5
    });
    const obstacle = api.createLabel(layer, {
      anchor: { kind: "world", position: [0, 0, 0.5] },
      text: "obstacle"
    });
    const shifted = api.createLabel(layer, {
      anchor: { kind: "world", position: [0, 0, 0.5] },
      text: "shifted",
      collision: "shift",
      collisionMaxShift: 48,
      leaderLine: { color: "#58e6bd", width: 2, minLength: 8 }
    });

    api.updateAnnotationLayer(layer);
    expect(api.getAnnotationSnapshot(shifted)).toEqual(expect.objectContaining({
      rendered: true,
      hiddenReason: "none",
      screenPosition: { x: 50, y: 38 },
      layoutOffset: { x: 0, y: -12 }
    }));
    expect(backend.resources[1]?.update?.leaderLineGeometry).toEqual({
      start: { x: 50, y: 50 },
      end: { x: 50, y: 43 }
    });

    api.setAnnotationAnchor(obstacle, { kind: "world", position: [0.8, 0, 0.5] });
    api.updateAnnotationLayer(layer);
    expect(api.getAnnotationSnapshot(shifted)).toEqual(expect.objectContaining({
      rendered: true,
      screenPosition: { x: 50, y: 50 },
      layoutOffset: { x: 0, y: 0 }
    }));
    expect(backend.resources[1]?.update?.leaderLineGeometry).toBeNull();
  });

  it("falls back to collision hiding when no shift placement fits", async () => {
    const api = await import("../../src/index.js");
    const layer = api.createAnnotationLayer({
      scene: {} as never,
      camera: {} as never,
      canvas: fakeCanvas(),
      backend: new FakeBackend()
    });
    api.createLabel(layer, {
      anchor: { kind: "world", position: [0, 0, 0.5] },
      text: "obstacle"
    });
    const shifted = api.createLabel(layer, {
      anchor: { kind: "world", position: [0, 0, 0.5] },
      text: "shifted",
      collision: "shift",
      collisionMaxShift: 6
    });

    api.updateAnnotationLayer(layer);
    expect(api.getAnnotationSnapshot(shifted).hiddenReason).toBe("collision");
    expect(api.getAnnotationSnapshot(shifted).layoutOffset).toBeNull();
  });

  it("supports axis-only and radial collision placement", async () => {
    const api = await import("../../src/index.js");
    const layer = api.createAnnotationLayer({
      scene: {} as never,
      camera: {} as never,
      canvas: fakeCanvas(),
      backend: new FakeBackend()
    });
    api.createLabel(layer, {
      anchor: { kind: "world", position: [0, 0, 0.5] },
      text: "obstacle"
    });
    const moved = api.createLabel(layer, {
      anchor: { kind: "world", position: [0, 0, 0.5] },
      text: "moved",
      collision: "shift-x",
      collisionMaxShift: 48
    });

    api.updateAnnotationLayer(layer);
    const horizontal = api.getAnnotationSnapshot(moved).layoutOffset;
    expect(Math.abs(horizontal?.x ?? 0)).toBeGreaterThan(0);
    expect(horizontal?.y).toBe(0);

    api.updateLabel(moved, { collision: "shift-y" });
    api.updateAnnotationLayer(layer);
    const vertical = api.getAnnotationSnapshot(moved).layoutOffset;
    expect(vertical?.x).toBe(0);
    expect(Math.abs(vertical?.y ?? 0)).toBeGreaterThan(0);

    api.updateLabel(moved, { collision: "radial" });
    api.updateAnnotationLayer(layer);
    const radial = api.getAnnotationSnapshot(moved).layoutOffset;
    expect(Math.abs(radial?.x ?? 0)).toBeGreaterThan(0);
    expect(Math.abs(radial?.y ?? 0)).toBeGreaterThan(0);

    api.updateLabel(moved, { collision: "repel" });
    api.updateAnnotationLayer(layer);
    const repelled = api.getAnnotationSnapshot(moved);
    expect(repelled.rendered).toBe(true);
    expect(Math.hypot(repelled.layoutOffset?.x ?? 0, repelled.layoutOffset?.y ?? 0)).toBeGreaterThan(0);
  });

  it("clusters overlapping labels into one summary and restores their text", async () => {
    const api = await import("../../src/index.js");
    const backend = new FakeBackend();
    const layer = api.createAnnotationLayer({
      scene: {} as never,
      camera: {} as never,
      canvas: fakeCanvas(),
      backend
    });
    const labels = ["one", "two", "three"].map((text) =>
      api.createLabel(layer, {
        anchor: { kind: "world", position: [0, 0, 0.5] },
        text,
        collision: "cluster"
      })
    );

    api.updateAnnotationLayer(layer);
    expect(backend.resources[0]?.update?.text).toBe("3 labels");
    expect(api.getAnnotationSnapshot(labels[0]!).rendered).toBe(true);
    expect(api.getAnnotationSnapshot(labels[1]!).hiddenReason).toBe("collision");
    expect(api.getAnnotationSnapshot(labels[2]!).hiddenReason).toBe("collision");

    api.setAnnotationAnchor(labels[1]!, { kind: "world", position: [-0.8, 0, 0.5] });
    api.setAnnotationAnchor(labels[2]!, { kind: "world", position: [0.8, 0, 0.5] });
    api.updateAnnotationLayer(layer);
    expect(backend.resources[0]?.update?.text).toBe("one");
    expect(labels.map((label) => api.getAnnotationSnapshot(label).rendered)).toEqual([
      true,
      true,
      true
    ]);
  });

  it("validates leader-line options and supports disabling them", async () => {
    const api = await import("../../src/index.js");
    const layer = api.createAnnotationLayer({
      scene: {} as never,
      camera: {} as never,
      canvas: fakeCanvas(),
      backend: new FakeBackend()
    });
    expect(() => api.createLabel(layer, {
      anchor: { kind: "world", position: [0, 0, 0.5] },
      text: "invalid",
      leaderLine: { width: 0 }
    })).toThrow(/Leader line width/);
    const label = api.createLabel(layer, {
      anchor: { kind: "world", position: [0, 0, 0.5] },
      text: "valid",
      leaderLine: true
    });
    expect(() => api.updateLabel(label, {
      leaderLine: { opacity: 2 }
    })).toThrow(/opacity/);
    expect(() => api.updateLabel(label, {
      leaderLine: { minLength: -1 }
    })).toThrow(/minimum length/);
    expect(() => api.updateLabel(label, { leaderLine: false })).not.toThrow();
  });

  it("resolves a dense 500-label collision set deterministically", async () => {
    const api = await import("../../src/index.js");
    const layer = api.createAnnotationLayer({
      scene: {} as never,
      camera: {} as never,
      canvas: fakeCanvas(),
      backend: new FakeBackend()
    });
    const labels = Array.from({ length: 500 }, (_, index) => api.createLabel(layer, {
      anchor: { kind: "world", position: [0, 0, 0.5] },
      text: `sensor-${index}`,
      collision: "hide",
      zIndex: 500 - index
    }));

    api.updateAnnotationLayer(layer);
    const snapshots = labels.map(api.getAnnotationSnapshot);
    expect(snapshots.filter((snapshot) => snapshot.rendered)).toHaveLength(1);
    expect(snapshots[0]?.rendered).toBe(true);
    expect(snapshots.slice(1).every((snapshot) => snapshot.hiddenReason === "collision")).toBe(true);
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
