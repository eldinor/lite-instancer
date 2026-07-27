import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FakeBackend } from "./fake-backend.js";

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

class InteractiveCanvas {
  readonly listeners = new Map<string, Set<(event: Event) => void>>();
  width = 100;
  height = 100;
  clientWidth = 100;
  clientHeight = 100;

  addEventListener(type: string, listener: EventListenerOrEventListenerObject): void {
    const callback = typeof listener === "function" ? listener : (event: Event) => listener.handleEvent(event);
    let listeners = this.listeners.get(type);
    if (!listeners) {
      listeners = new Set();
      this.listeners.set(type, listeners);
    }
    listeners.add(callback);
  }

  removeEventListener(type: string, listener: EventListenerOrEventListenerObject): void {
    if (typeof listener === "function") this.listeners.get(type)?.delete(listener);
  }

  emit(type: string, values: Record<string, unknown> = {}): void {
    const event = {
      type,
      pointerId: 1,
      pointerType: "mouse",
      button: 0,
      buttons: type === "pointerdown" ? 1 : 0,
      clientX: 50,
      clientY: 50,
      timeStamp: 100,
      altKey: false,
      ctrlKey: false,
      metaKey: false,
      shiftKey: false,
      preventDefault: vi.fn(),
      ...values
    } as unknown as Event;
    for (const listener of this.listeners.get(type) ?? []) listener(event);
  }

  getBoundingClientRect(): DOMRect {
    return {
      x: 0, y: 0, left: 0, top: 0, right: 100, bottom: 100,
      width: 100, height: 100, toJSON: () => ({})
    } as DOMRect;
  }
}

describe("annotation interaction", () => {
  const frames: Array<FrameRequestCallback | undefined> = [];

  beforeEach(() => {
    vi.resetModules();
    frames.length = 0;
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      frames.push(callback);
      return frames.length;
    });
    vi.stubGlobal("cancelAnimationFrame", (handle: number) => {
      frames[handle - 1] = undefined;
    });
  });

  afterEach(() => vi.unstubAllGlobals());

  it("picks the highest logical z-index and follows visibility and target state", async () => {
    const core = await import("../../src/index.js");
    const interaction = await import("../../src/interaction.js");
    const backend = new FakeBackend();
    backend.bounds = { x: 40, y: 40, width: 20, height: 20 };
    const canvas = new InteractiveCanvas();
    const layer = core.createAnnotationLayer({ scene: {} as never, camera: {} as never, canvas: canvas as never, backend });
    const low = core.createMarker(layer, { anchor: { kind: "world", position: [0, 0, 0.5] }, zIndex: 1 });
    const high = core.createMarker(layer, { anchor: { kind: "world", position: [0, 0, 0.5] }, zIndex: 5 });
    const manager = interaction.createAnnotationInteractionManager({ layer, canvas: canvas as never });
    const lowTarget = interaction.registerInteractiveAnnotation(manager, low);
    const highTarget = interaction.registerInteractiveAnnotation(manager, high);
    core.updateAnnotationLayer(layer);

    expect(interaction.pickInteractiveAnnotation(manager, 50, 50)).toBe(highTarget);
    interaction.setInteractiveAnnotationEnabled(highTarget, false);
    expect(interaction.pickInteractiveAnnotation(manager, 50, 50)).toBe(lowTarget);
    core.setAnnotationVisible(low, false);
    core.updateAnnotationLayer(layer);
    expect(interaction.pickInteractiveAnnotation(manager, 50, 50)).toBeNull();
    expect(interaction.getAnnotationInteractionDiagnostics(manager)).toMatchObject({
      registeredTargets: 2,
      indexedTargets: 0,
      picks: 3,
      hits: 2
    });
  });

  it("uses shape-aware marker tests with rectangle fallback", async () => {
    const core = await import("../../src/index.js");
    const interaction = await import("../../src/interaction.js");
    const backend = new FakeBackend();
    backend.bounds = { x: 0, y: 0, width: 20, height: 20 };
    const canvas = new InteractiveCanvas();
    const layer = core.createAnnotationLayer({ scene: {} as never, camera: {} as never, canvas: canvas as never, backend });
    const dot = core.createMarker(layer, { anchor: { kind: "world", position: [-0.5, 0, 0.5] }, shape: "dot" });
    const square = core.createMarker(layer, { anchor: { kind: "world", position: [0.5, 0, 0.5] }, shape: "square" });
    const manager = interaction.createAnnotationInteractionManager({ layer, canvas: canvas as never });
    const dotTarget = interaction.registerInteractiveAnnotation(manager, dot);
    const squareTarget = interaction.registerInteractiveAnnotation(manager, square);
    core.updateAnnotationLayer(layer);

    expect(interaction.pickInteractiveAnnotation(manager, 25, 50)).toBe(dotTarget);
    expect(interaction.pickInteractiveAnnotation(manager, 16, 41)).toBeNull();
    expect(interaction.pickInteractiveAnnotation(manager, 66, 41)).toBe(squareTarget);
  });

  it("coalesces hover and recognizes same-target clicks", async () => {
    const core = await import("../../src/index.js");
    const interaction = await import("../../src/interaction.js");
    const backend = new FakeBackend();
    backend.bounds = { x: 40, y: 40, width: 20, height: 20 };
    const canvas = new InteractiveCanvas();
    const layer = core.createAnnotationLayer({ scene: {} as never, camera: {} as never, canvas: canvas as never, backend });
    const marker = core.createMarker(layer, { anchor: { kind: "world", position: [0, 0, 0.5] }, shape: "square" });
    const manager = interaction.createAnnotationInteractionManager({ layer, canvas: canvas as never });
    const target = interaction.registerInteractiveAnnotation(manager, marker);
    core.updateAnnotationLayer(layer);
    const events: string[] = [];
    interaction.onAnnotationInteraction(target, "hoverstart", (event) => events.push(`${event.type}:${event.canvasX}`));
    interaction.onAnnotationInteraction(target, "click", (event) => events.push(event.type));

    canvas.emit("pointermove", { clientX: 48 });
    canvas.emit("pointermove", { clientX: 50 });
    frames[0]?.(0);
    canvas.emit("pointerdown", { clientX: 50, timeStamp: 100 });
    canvas.emit("pointerup", { clientX: 50, timeStamp: 120 });

    expect(events).toEqual(["hoverstart:50", "click"]);
    expect(interaction.getHoveredAnnotation(manager)).toBe(marker);
    expect(interaction.getAnnotationInteractionDiagnostics(manager)).toMatchObject({
      hoverSamples: 1,
      coalescedHoverSamples: 1
    });
  });

  it("keeps a static spatial index, incrementally moves one target, and removes disposed annotations", async () => {
    const core = await import("../../src/index.js");
    const interaction = await import("../../src/interaction.js");
    const backend = new FakeBackend();
    backend.bounds = { x: 40, y: 40, width: 20, height: 20 };
    const canvas = new InteractiveCanvas();
    const camera = { viewport: { x: 0, y: 0, width: 1, height: 1 } };
    const layer = core.createAnnotationLayer({ scene: {} as never, camera: camera as never, canvas: canvas as never, backend });
    const marker = core.createMarker(layer, { anchor: { kind: "world", position: [0, 0, 0.5] }, shape: "square" });
    const manager = interaction.createAnnotationInteractionManager({ layer, canvas: canvas as never });
    const target = interaction.registerInteractiveAnnotation(manager, marker);
    core.updateAnnotationLayer(layer);
    interaction.pickInteractiveAnnotation(manager, 50, 50);
    const initial = interaction.getAnnotationInteractionDiagnostics(manager);

    core.updateAnnotationLayer(layer);
    interaction.pickInteractiveAnnotation(manager, 50, 50);
    expect(interaction.getAnnotationInteractionDiagnostics(manager).indexRebuilds).toBe(initial.indexRebuilds);

    camera.viewport.width = 0.8;
    core.updateAnnotationLayer(layer);
    interaction.pickInteractiveAnnotation(manager, 40, 50);
    expect(interaction.getAnnotationInteractionDiagnostics(manager)).toMatchObject({
      indexRebuilds: initial.indexRebuilds,
      incrementalIndexUpdates: initial.incrementalIndexUpdates + 1
    });

    core.disposeAnnotation(marker);
    expect(interaction.pickInteractiveAnnotation(manager, 40, 50)).toBeNull();
    expect(() => interaction.onAnnotationInteraction(target, "click", () => {})).toThrow(/disposed/);
    interaction.disposeAnnotationInteractionManager(manager);
    interaction.disposeAnnotationInteractionManager(manager);
  });

  it("uses one full rebuild for camera-wide region changes", async () => {
    const core = await import("../../src/index.js");
    const interaction = await import("../../src/interaction.js");
    const backend = new FakeBackend();
    const canvas = new InteractiveCanvas();
    const camera = { viewport: { x: 0, y: 0, width: 1, height: 1 } };
    const layer = core.createAnnotationLayer({ scene: {} as never, camera: camera as never, canvas: canvas as never, backend });
    const manager = interaction.createAnnotationInteractionManager({ layer, canvas: canvas as never });
    for (let index = 0; index < 40; index++) {
      const marker = core.createMarker(layer, { anchor: { kind: "world", position: [0, 0, 0.5] } });
      interaction.registerInteractiveAnnotation(manager, marker);
    }
    core.updateAnnotationLayer(layer);
    interaction.pickInteractiveAnnotation(manager, 50, 50);
    const initial = interaction.getAnnotationInteractionDiagnostics(manager);

    camera.viewport.width = 0.8;
    core.updateAnnotationLayer(layer);
    interaction.pickInteractiveAnnotation(manager, 40, 50);
    expect(interaction.getAnnotationInteractionDiagnostics(manager)).toMatchObject({
      indexRebuilds: initial.indexRebuilds + 1,
      incrementalIndexUpdates: initial.incrementalIndexUpdates
    });
  });
});
