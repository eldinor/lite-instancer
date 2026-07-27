import "./webgpu-globals.js";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createFontFromBuffer, type SurfaceContext } from "@babylonjs/lite";
import { describe, expect, it } from "vitest";
import {
  createTextRendererAnnotationBackend,
  type TextRendererAnnotationBackendOptions
} from "../../src/textrender.js";
import type {
  AnnotationId,
  BackendAnnotationDefinition,
  BackendAnnotationUpdate,
  MarkerShape
} from "../../src/types.js";

const fontBytes = readFileSync(fileURLToPath(new URL("../../examples/textrender/assets/InterVariable.ttf", import.meta.url)));
const fontBuffer = fontBytes.buffer.slice(fontBytes.byteOffset, fontBytes.byteOffset + fontBytes.byteLength);
const font = createFontFromBuffer(fontBuffer);

describe("TextRenderer annotation backend", () => {
  it("uses the public shaping bridge by default and caches shapes", () => {
    const { backend } = fixture();
    const first = backend.create(labelDefinition("Pump A-12"));
    const second = backend.create(labelDefinition("Pump A-12", 2));
    expect(backend.getStats()).toMatchObject({
      requestedShapingMode: "public",
      cacheHits: 1,
      cacheMisses: 1,
      publicShapes: 1,
      privateShapes: 0,
      liveLabels: 2
    });
    backend.disposeResource(first);
    backend.disposeResource(second);
    backend.dispose();
    backend.dispose();
    expect(backend.getStats().liveLabels).toBe(0);
  });

  it("uses guarded private layout when explicitly requested", () => {
    const { backend } = fixture({ shapingMode: "guarded-private" });
    backend.create(labelDefinition("Private bridge"));
    expect(backend.getStats()).toMatchObject({
      requestedShapingMode: "guarded-private",
      privateAdapterAvailable: true,
      privateShapes: 1,
      privateFallbacks: 0,
      publicShapes: 0
    });
    backend.dispose();
  });

  it("measures centered text and updates position, visibility, text, and z-index", () => {
    const { backend } = fixture();
    const definition = labelDefinition("Valve 7");
    const resource = backend.create(definition);
    backend.update(resource, updateFor(definition, { x: 80, y: 45 }));
    const initial = backend.measure(resource);
    expect(initial).not.toBeNull();
    expect(initial!.x + initial!.width * 0.5).toBeCloseTo(80);
    expect(initial!.y + initial!.height * 0.5).toBeCloseTo(45);

    const changed = { ...definition, text: "Valve 700", zIndex: 9 };
    backend.update(resource, updateFor(changed, { x: 25, y: 30 }));
    expect(backend.measure(resource)!.width).toBeGreaterThan(initial!.width);
    backend.update(resource, { ...updateFor(changed, null), rendered: false });
    expect(backend.measure(resource)).toBeNull();
    expect(runColor(resource)).toEqual([0, 0, 0, 0]);
    backend.disposeResource(resource);
    expect(backend.getStats().liveLabels).toBe(0);
    backend.dispose();
  });

  it("evicts least-recently-used shapes at the configured limit", () => {
    const { backend } = fixture({ shapeCacheSize: 1 });
    backend.create(labelDefinition("A", 1));
    backend.create(labelDefinition("B", 2));
    backend.create(labelDefinition("A", 3));
    expect(backend.getStats()).toMatchObject({ cacheHits: 0, cacheMisses: 3, publicShapes: 3 });
    backend.dispose();
  });

  it("supports CSS hex color, opacity, font size, and semantic metadata", () => {
    const { backend } = fixture();
    const definition = labelDefinition("Status", 1, {
      color: "#71d7ffcc",
      opacity: 0.5,
      fontSize: 22
    });
    const resource = backend.create({ ...definition, ariaLabel: "Status", role: "note" });
    backend.update(resource, updateFor(definition, { x: 10, y: 10 }));
    const color = runColor(resource);
    expect(color[3]).toBeCloseTo(0.4);
    expect(color[0]).toBeLessThanOrEqual(color[3]);
    expect(color[1]).toBeLessThanOrEqual(color[3]);
    expect(color[2]).toBeLessThanOrEqual(color[3]);
    backend.dispose();
  });

  it.each([
    ["fontWeight", { fontWeight: 700 }],
    ["className", { className: "label" }],
    ["opacity transition", { opacityTransitionDuration: 100 }]
  ])("rejects unsupported %s styling", (_name, style) => {
    const { backend } = fixture();
    expect(() => backend.create(labelDefinition("Unsupported", 1, style))).toThrow(/does not support/);
    backend.dispose();
  });

  it("renders padded rounded label backgrounds as one nine-slice draw call", () => {
    const { backend, surface } = fixture();
    const plain = labelDefinition("Valve 7", 1, { fontSize: 20 });
    const styled = labelDefinition("Valve 7", 2, {
      color: "#ffffff",
      backgroundColor: "#10251fcc",
      borderColor: "#58e6bd",
      borderWidth: 2,
      borderRadius: 6,
      padding: 8,
      opacity: 0.5,
      fontSize: 20
    });
    const plainResource = backend.create(plain);
    const resource = backend.create(styled);
    backend.update(plainResource, updateFor(plain, { x: 20, y: 20 }));
    backend.update(resource, updateFor(styled, { x: 80, y: 45 }));

    const plainBounds = backend.measure(plainResource)!;
    const bounds = backend.measure(resource)!;
    expect(bounds.width - plainBounds.width).toBeCloseTo(20);
    expect(bounds.height - plainBounds.height).toBeCloseTo(20);
    const layer = backgroundLayer(resource);
    expect(renderingKinds(surface)).toEqual(["sprite-renderer", "text-renderer"]);
    expect(layer.count).toBe(9);
    expect(layer.visible).toBe(true);
    expect(Array.from(layer._instanceData.slice(2, 4))).toEqual([7, 7]);
    for (const value of layer._instanceData.slice(9, 13)) expect(value).toBeCloseTo(0.5);
    expect(backend.getStats()).toMatchObject({
      liveLabelBackgrounds: 1,
      labelBackgroundSprites: 9,
      labelBackgroundDrawCalls: 1,
      spriteDrawCalls: 1
    });

    const ids = (resource as { background: { sprites: Array<{ id: number }> } }).background.sprites.map(({ id }) => id);
    backend.update(resource, updateFor(styled, { x: 90, y: 50 }));
    expect((resource as { background: { sprites: Array<{ id: number }> } }).background.sprites.map(({ id }) => id)).toEqual(ids);
    backend.update(resource, updateFor(styled, null));
    expect(layer.visible).toBe(false);
    expect(backend.getStats().labelBackgroundDrawCalls).toBe(0);

    backend.disposeResource(resource);
    expect(backend.getStats()).toMatchObject({
      liveLabelBackgrounds: 0,
      labelBackgroundSprites: 0,
      spriteBuckets: 0
    });
    backend.disposeResource(plainResource);
    backend.dispose();
  });

  it("supports padding-only layout and validates label box dimensions", () => {
    const { backend } = fixture();
    const plain = labelDefinition("Padded", 1);
    const padded = labelDefinition("Padded", 2, { padding: 5 });
    const plainResource = backend.create(plain);
    const paddedResource = backend.create(padded);
    backend.update(plainResource, updateFor(plain, { x: 20, y: 20 }));
    backend.update(paddedResource, updateFor(padded, { x: 20, y: 20 }));
    expect(backend.measure(paddedResource)!.width - backend.measure(plainResource)!.width).toBeCloseTo(10);
    expect(backend.getStats().liveLabelBackgrounds).toBe(0);
    for (const style of [{ padding: -1 }, { borderWidth: -1 }, { borderRadius: -1 }]) {
      expect(() => backend.create(labelDefinition("Invalid", 3, style))).toThrow(/non-negative/);
    }
    backend.dispose();
  });

  it("batches styled dot and ring markers in one Sprite2D draw call", () => {
    const { backend, surface } = fixture();
    const dot = markerDefinition("dot", 18, {
      backgroundColor: "#58e6bd",
      borderColor: "#ffffff",
      borderWidth: 2,
      opacity: 0.6
    });
    const dotResource = backend.create(dot);
    expect(backend.getStats()).toMatchObject({
      spriteRendererActive: true,
      liveMarkers: 1,
      markerSprites: 1,
      markerDrawCalls: 0
    });
    expect(renderingKinds(surface)).toEqual(["sprite-renderer", "text-renderer"]);
    backend.update(dotResource, updateFor(dot, { x: 40, y: 30 }));
    const layer = markerLayer(dotResource);
    const data = layer._instanceData;
    expect(layer.count).toBe(1);
    expect(layer.visible).toBe(true);
    expect(Array.from(data.slice(0, 4))).toEqual([40, 30, 18, 18]);
    for (const value of data.slice(9, 13)) expect(value).toBeCloseTo(0.6);
    expect(backend.measure(dotResource)).toEqual({ x: 31, y: 21, width: 18, height: 18 });
    expect(backend.getStats().markerDrawCalls).toBe(1);

    const ring = markerDefinition("ring", 24, { color: "#72e6ff", borderWidth: 3 }, 2);
    const ringResource = backend.create(ring);
    backend.update(ringResource, updateFor(ring, { x: 80, y: 50 }));
    expect(layer.count).toBe(2);
    expect(backend.getStats()).toMatchObject({ liveMarkers: 2, markerSprites: 2, markerDrawCalls: 1 });
    expect(data[17]).not.toBe(data[4]);

    backend.update(dotResource, updateFor(dot, null));
    expect(data[2]).toBe(0);
    backend.disposeResource(dotResource);
    backend.disposeResource(ringResource);
    expect(layer.count).toBe(0);
    expect(layer.visible).toBe(false);
    expect(backend.getStats()).toMatchObject({ liveMarkers: 0, markerSprites: 0, markerDrawCalls: 0 });
    backend.dispose();
  });

  it("applies position-only marker batches without rebuilding marker definitions", () => {
    const { backend } = fixture();
    const definition = markerDefinition("dot", 18, { backgroundColor: "#58e6bd" });
    const resource = backend.create(definition);
    backend.update(resource, updateFor(definition, { x: 20, y: 20 }));
    backend.updateMarkerPositions?.([{ resource, rendered: true, x: 75, y: 60 }]);
    expect(Array.from(markerLayer(resource)._instanceData.slice(0, 4))).toEqual([75, 60, 18, 18]);
    expect(backend.measure(resource)).toEqual({ x: 66, y: 51, width: 18, height: 18 });
    backend.updateMarkerPositions?.([{ resource, rendered: false, x: 75, y: 60 }]);
    expect(markerLayer(resource).visible).toBe(false);
    expect(backend.measure(resource)).toBeNull();
    expect(backend.getStats()).toMatchObject({
      fullMarkerUpdates: 1,
      markerPositionBatches: 2,
      batchedMarkerPositions: 2
    });
    backend.dispose();
  });

  it.each(["dot", "ring", "square", "diamond", "triangle", "cross", "pin"] as const)(
    "renders the built-in %s marker as one sprite",
    (shape) => {
      const { backend } = fixture();
      const definition = markerDefinition(shape, 24, { color: "#58e6bd", borderWidth: 2 });
      const resource = backend.create(definition);
      backend.update(resource, updateFor(definition, { x: 40, y: 30 }));
      expect(backend.getStats()).toMatchObject({ liveMarkers: 1, markerSprites: 1, markerDrawCalls: 1 });
      backend.dispose();
    }
  );

  it("supports namespaced custom marker rasterizers and rejects unknown shapes", () => {
    let receivedSize = 0;
    const { backend } = fixture({
      markerShapes: {
        "factory/valve": (context) => {
          receivedSize = context.size;
          return new Uint8Array(context.frameSize * context.frameSize * 4);
        }
      }
    });
    const custom = markerDefinition("factory/valve", 26);
    expect(backend.supportsMarkerShape("diamond")).toBe(true);
    expect(backend.supportsMarkerShape("factory/valve")).toBe(true);
    expect(backend.supportsMarkerShape("factory/missing")).toBe(false);
    backend.create(custom);
    expect(receivedSize).toBe(26);
    expect(() => backend.create(markerDefinition("factory/missing", 20, {}, 2))).toThrow(
      'Unknown GPU marker shape "factory/missing"'
    );
    backend.dispose();
  });

  it("validates custom marker registries and raster output", () => {
    expect(() => fixture({ markerShapes: { dot: () => new Uint8Array() } })).toThrow(/cannot replace built-in/);
    const { backend } = fixture({ markerShapes: { "app/bad": () => new Uint8Array(4) } });
    expect(() => backend.create(markerDefinition("app/bad", 12))).toThrow(/Uint8Array of length/);
    backend.dispose();
  });

  it("batches Sprite2D resources by z-index and removes empty buckets", () => {
    const { backend } = fixture();
    const low = markerDefinition("dot", 18);
    const high = { ...markerDefinition("diamond", 18, {}, 2), zIndex: 10 };
    const lowResource = backend.create(low);
    const highResource = backend.create(high);
    backend.update(lowResource, updateFor(low, { x: 20, y: 20 }));
    backend.update(highResource, updateFor(high, { x: 30, y: 30 }));
    expect(backend.getStats()).toMatchObject({
      spriteBuckets: 2,
      spriteDrawCalls: 2,
      markerDrawCalls: 2,
      markerSprites: 2
    });

    const moved = { ...low, zIndex: 10 };
    backend.update(lowResource, updateFor(moved, { x: 20, y: 20 }));
    expect(markerLayer(lowResource)).toBe(markerLayer(highResource));
    expect(backend.getStats()).toMatchObject({ spriteBuckets: 1, spriteDrawCalls: 1, markerDrawCalls: 1 });

    backend.disposeResource(lowResource);
    backend.disposeResource(highResource);
    expect(backend.getStats()).toMatchObject({ spriteBuckets: 0, spriteDrawCalls: 0 });
    backend.dispose();
  });

  it("runs marker pulses in a lazy Sprite FX layer and returns to the static path", () => {
    const { backend } = fixture();
    const staticDefinition = markerDefinition("dot", 20);
    const animatedDefinition = {
      ...markerDefinition("diamond", 20, { opacity: 0.8 }, 2),
      animation: { type: "pulse" as const, frequency: 2, phase: 0.25, minOpacity: 0.2, maxOpacity: 0.9 }
    };
    const staticResource = backend.create(staticDefinition);
    const animatedResource = backend.create(animatedDefinition);
    backend.update(staticResource, updateFor(staticDefinition, { x: 20, y: 20 }));
    backend.update(animatedResource, updateFor(animatedDefinition, { x: 30, y: 30 }));
    const animatedLayer = markerLayer(animatedResource) as ReturnType<typeof markerLayer> & { customShader?: unknown };
    expect(animatedLayer).not.toBe(markerLayer(staticResource));
    expect(animatedLayer.customShader).toBeDefined();
    expect(Array.from(animatedLayer._instanceData.slice(9, 13))).toEqual([0.25, 2, expect.closeTo(0.16), expect.closeTo(0.72)]);
    expect(backend.getStats()).toMatchObject({
      liveAnimatedMarkers: 1,
      spriteBuckets: 1,
      markerDrawCalls: 2,
      animatedMarkerDrawCalls: 1
    });

    const { animation: _animation, ...stoppedDefinition } = animatedDefinition;
    backend.update(animatedResource, updateFor(stoppedDefinition, { x: 30, y: 30 }));
    expect(markerLayer(animatedResource)).toBe(markerLayer(staticResource));
    expect(backend.getStats()).toMatchObject({
      liveAnimatedMarkers: 0,
      markerDrawCalls: 1,
      animatedMarkerDrawCalls: 0
    });
    backend.dispose();
  });

  it("keeps lines behind markers inside a shared z-index bucket", () => {
    const { backend } = fixture();
    const label = { ...labelDefinition("Callout"), zIndex: 4, leaderLine: { width: 2 } };
    const marker = { ...markerDefinition("pin", 20, {}, 2), zIndex: 4 };
    const labelResource = backend.create(label);
    const markerResource = backend.create(marker);
    backend.update(labelResource, {
      ...updateFor(label, { x: 40, y: 40 }),
      leaderLineGeometry: { start: { x: 10, y: 10 }, end: { x: 30, y: 30 } }
    });
    backend.update(markerResource, updateFor(marker, { x: 10, y: 10 }));
    const line = lineLayer(labelResource) as { order?: number };
    const markerSpriteLayer = markerLayer(markerResource) as { order?: number };
    expect(line.order).toBe(4);
    expect(markerSpriteLayer.order).toBe(4);
    expect(backend.getStats()).toMatchObject({
      spriteBuckets: 1,
      spriteDrawCalls: 2,
      leaderLineDrawCalls: 1,
      markerDrawCalls: 1
    });
    const movedLabel = { ...label, zIndex: 9 };
    backend.update(labelResource, {
      ...updateFor(movedLabel, { x: 40, y: 40 }),
      leaderLineGeometry: { start: { x: 10, y: 10 }, end: { x: 30, y: 30 } }
    });
    expect((lineLayer(labelResource) as { order?: number }).order).toBe(9);
    expect(backend.getStats()).toMatchObject({ spriteBuckets: 2, spriteDrawCalls: 2 });
    backend.dispose();
  });

  it("rejects DOM-only marker styling", () => {
    const { backend } = fixture();
    expect(() => backend.create(markerDefinition("dot", 12, { className: "marker" }))).toThrow(/marker style.className/);
    backend.dispose();
  });

  it("reuses cached atlas frames for identical marker appearances", () => {
    const { backend } = fixture();
    const definition = markerDefinition("ring", 28, { color: "#58e6bd", borderWidth: 3 });
    const first = backend.create(definition) as { frame: number; sprite: { layer: { atlas: { frames: unknown[] } } } };
    const frameCount = first.sprite.layer.atlas.frames.length;
    const second = backend.create({ ...definition, id: 2 as AnnotationId }) as { frame: number };
    expect(second.frame).toBe(first.frame);
    expect(first.sprite.layer.atlas.frames).toHaveLength(frameCount);
    backend.dispose();
  });

  it("reuses an unbordered dot frame across animated size and opacity updates", () => {
    const { backend } = fixture();
    const initial = markerDefinition("dot", 14, { color: "#72e6ff", opacity: 0.5 });
    const resource = backend.create(initial) as { frame: number; sprite: { layer: { atlas: { frames: unknown[] } } } };
    const frame = resource.frame;
    const frameCount = resource.sprite.layer.atlas.frames.length;
    const animated = markerDefinition("dot", 28, { color: "#72e6ff", opacity: 0.9 });
    backend.update(resource, updateFor(animated, { x: 30, y: 30 }));
    expect(resource.frame).toBe(frame);
    expect(resource.sprite.layer.atlas.frames).toHaveLength(frameCount);
    backend.dispose();
  });

  it("lazily creates one square sprite per leader line and draws it behind text", () => {
    const { backend, surface } = fixture();
    expect(backend.getStats().spriteRendererActive).toBe(false);
    const definition = { ...labelDefinition("Line"), leaderLine: { width: 4, color: "#ff8000", opacity: 0.5 } };
    const resource = backend.create(definition);
    expect(backend.getStats()).toMatchObject({
      spriteRendererActive: true,
      liveLeaderLines: 1,
      leaderLineSprites: 1,
      leaderLineDrawCalls: 0,
      textBuckets: 1,
      textDrawCalls: 1
    });
    expect(renderingKinds(surface)).toEqual(["sprite-renderer", "text-renderer"]);
    const secondResource = backend.create({ ...definition, id: 2 as AnnotationId });
    expect(renderingKinds(surface)).toEqual(["sprite-renderer", "text-renderer"]);
    expect(backend.getStats().leaderLineSprites).toBe(2);
    backend.disposeResource(secondResource);

    backend.update(resource, {
      ...updateFor(definition, { x: 30, y: 40 }),
      leaderLineGeometry: { start: { x: 10, y: 20 }, end: { x: 40, y: 60 } }
    });
    const layer = lineLayer(resource);
    const data = layer._instanceData;
    expect(layer.count).toBe(1);
    expect(data[0]).toBeCloseTo(25);
    expect(data[1]).toBeCloseTo(40);
    expect(data[2]).toBeCloseTo(50);
    expect(data[3]).toBeCloseTo(4);
    expect(data[8]).toBeCloseTo(Math.atan2(40, 30));
    expect(data[12]).toBeCloseTo(0.5);
    expect(data[9]).toBeLessThanOrEqual(data[12]!);
    expect(backend.getStats().leaderLineDrawCalls).toBe(1);

    backend.update(resource, { ...updateFor(definition, null), leaderLineGeometry: null });
    expect(data[2]).toBe(0);
    expect(data[3]).toBe(0);
    expect(backend.getStats().leaderLineDrawCalls).toBe(0);
    backend.dispose();
  });

  it("uses three reusable sprites for round caps and reallocates on cap changes", () => {
    const { backend } = fixture();
    const square = { ...labelDefinition("Caps"), leaderLine: { width: 6, lineCap: "square" as const } };
    const resource = backend.create(square);
    expect(lineLayer(resource).count).toBe(1);

    const round = { ...square, leaderLine: { width: 6, lineCap: "round" as const } };
    backend.update(resource, {
      ...updateFor(round, { x: 50, y: 30 }),
      leaderLineGeometry: { start: { x: 20, y: 30 }, end: { x: 80, y: 30 } }
    });
    const layer = lineLayer(resource);
    expect(layer.count).toBe(3);
    expect(backend.getStats()).toMatchObject({ liveLeaderLines: 1, leaderLineSprites: 3 });
    expect(layer._instanceData[2]).toBeCloseTo(60);
    expect(layer._instanceData[15]).toBeCloseTo(6);
    expect(layer._instanceData[28]).toBeCloseTo(6);
    const ids = (resource as { leaderLine: { sprites: Array<{ id: number }> } }).leaderLine.sprites.map((sprite) => sprite.id);

    backend.update(resource, { ...updateFor(round, null), leaderLineGeometry: null });
    expect(layer._instanceData[2]).toBe(0);
    expect(layer._instanceData[15]).toBe(0);
    expect(layer._instanceData[28]).toBe(0);
    backend.update(resource, {
      ...updateFor(round, { x: 50, y: 30 }),
      leaderLineGeometry: { start: { x: 20, y: 30 }, end: { x: 80, y: 30 } }
    });
    expect((resource as { leaderLine: { sprites: Array<{ id: number }> } }).leaderLine.sprites.map((sprite) => sprite.id)).toEqual(ids);
    const { leaderLine: _removed, ...withoutLine } = round;
    backend.update(resource, { ...updateFor(withoutLine, { x: 50, y: 30 }), leaderLineGeometry: null });
    expect(layer.count).toBe(0);
    expect(backend.getStats()).toMatchObject({ liveLeaderLines: 0, leaderLineSprites: 0 });
    backend.disposeResource(resource);
    expect(layer.count).toBe(0);
    expect(backend.getStats()).toMatchObject({ liveLeaderLines: 0, leaderLineSprites: 0 });
    backend.dispose();
  });

  it("applies DPR scaling to the shared line layer and disposes it idempotently", () => {
    const { backend, surface } = fixture();
    const resource = backend.create({ ...labelDefinition("DPR"), leaderLine: { lineCap: "square" } });
    const marker = backend.create(markerDefinition("ring", 20));
    surface.canvas.width = 400;
    surface.canvas.height = 200;
    backend.setViewport({ left: 0, top: 0, width: 200, height: 100 });
    expect(lineLayer(resource).view.zoom).toBe(2);
    expect(markerLayer(marker).view.zoom).toBe(2);
    backend.dispose();
    backend.dispose();
    expect(renderingKinds(surface)).toEqual([]);
  });

  it("rejects non-uniform backing-store scale", () => {
    const { backend, surface } = fixture();
    surface.canvas.width = 200;
    surface.canvas.height = 150;
    expect(() => backend.setViewport({ left: 0, top: 0, width: 100, height: 100 })).toThrow(/uniform/);
    backend.dispose();
  });
});

function fixture(overrides: Partial<TextRendererAnnotationBackendOptions> = {}) {
  const canvas = { width: 200, height: 100 } as HTMLCanvasElement;
  const surface = {
    canvas,
    format: "bgra8unorm",
    _renderingContexts: [],
    _device: fakeGpuDevice()
  } as unknown as SurfaceContext;
  (surface as unknown as { engine: SurfaceContext }).engine = surface;
  const backend = createTextRendererAnnotationBackend({ surface, font, ...overrides });
  backend.setViewport({ left: 0, top: 0, width: 200, height: 100 });
  return { backend, surface };
}

function fakeGpuDevice() {
  return {
    queue: { writeTexture() {}, writeBuffer() {} },
    createTexture() {
      return { createView: () => ({}), destroy() {} };
    },
    createSampler: () => ({}),
    createBuffer(descriptor: { size: number }) {
      const memory = new ArrayBuffer(descriptor.size);
      return { size: descriptor.size, getMappedRange: () => memory, unmap() {}, destroy() {} };
    },
    createBindGroupLayout: () => ({}),
    createShaderModule: () => ({}),
    createPipelineLayout: () => ({}),
    createRenderPipeline: () => ({ getBindGroupLayout: () => ({}) })
  };
}

function renderingKinds(surface: SurfaceContext): string[] {
  return (surface as unknown as { _renderingContexts: Array<{ _kind: string }> })._renderingContexts.map((item) => item._kind);
}

function lineLayer(resource: unknown): {
  count: number;
  view: { zoom: number };
  _instanceData: Float32Array;
} {
  return (resource as { leaderLine: { sprites: Array<{ layer: unknown }> } }).leaderLine.sprites[0]!.layer as never;
}

function backgroundLayer(resource: unknown): {
  count: number;
  visible: boolean;
  view: { zoom: number };
  _instanceData: Float32Array;
} {
  return (resource as { background: { sprites: Array<{ layer: unknown }> } }).background.sprites[0]!.layer as never;
}

function markerLayer(resource: unknown): {
  count: number;
  visible: boolean;
  view: { zoom: number };
  _instanceData: Float32Array;
} {
  return (resource as { sprite: { layer: unknown } }).sprite.layer as never;
}

function markerDefinition(
  shape: MarkerShape,
  size: number,
  style: BackendAnnotationDefinition["style"] = {},
  id = 1
): BackendAnnotationDefinition {
  return { id: id as AnnotationId, type: "marker", shape, size, zIndex: 0, style };
}

function labelDefinition(
  text: string,
  id = 1,
  style: BackendAnnotationDefinition["style"] = {}
): BackendAnnotationDefinition {
  return { id: id as AnnotationId, type: "label", text, zIndex: 0, style };
}

function updateFor(
  definition: BackendAnnotationDefinition,
  screenPosition: Readonly<{ x: number; y: number }> | null
): BackendAnnotationUpdate {
  return {
    ...definition,
    definitionChanged: true,
    rendered: screenPosition !== null,
    screenPosition,
    leaderLineGeometry: null
  };
}

function runColor(resource: unknown): readonly [number, number, number, number] {
  return (resource as { run: { defaultColor: readonly [number, number, number, number] } }).run.defaultColor;
}
