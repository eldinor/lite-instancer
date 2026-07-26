import {
  addSprite2D,
  appendSpriteAtlasFrames,
  addTextRendererLayer,
  createDefaultTextData,
  createGlyphStorage,
  createSprite2DLayer,
  createSpriteAtlasFromFrames,
  createSpriteRenderer,
  createTextData,
  createTextLayer,
  createTextRenderer,
  disposeDefaultTextData,
  disposeGlyphStorage,
  disposeSpriteAtlas,
  disposeSpriteRenderer,
  disposeTextData,
  disposeTextRenderer,
  extractGlyphCurves,
  registerSpriteRenderer,
  registerTextRenderer,
  removeSprite2D,
  removeTextRendererLayer,
  srgbByteToLinear,
  spriteBlendPremultiplied,
  unregisterTextRenderer,
  updateSprite2D,
  updateGlyphStorage,
  updateTextData,
  type CurveSetId,
  type Font,
  type GlyphCurves,
  type GlyphRun,
  type GlyphStorage,
  type PlacedGlyph,
  type SurfaceContext,
  type Sprite2DHandle,
  type Sprite2DLayer,
  type SpriteAtlas,
  type SpriteRenderer,
  type TextData,
  type TextLayer,
  type TextRenderer
} from "@babylonjs/lite";
import { AnnotatorError } from "./error.js";
import type {
  AnnotationBackend,
  AnnotationViewport,
  BackendAnnotationDefinition,
  BackendAnnotationUpdate,
  BackendBounds,
  MarkerShape
} from "./types.js";
import { guardedPrivateLayoutText, type PrivateTextLayoutResult } from "./textrender-private.js";

export type TextRendererShapingMode = "public" | "guarded-private";

export type TextRendererMarkerColor = readonly [number, number, number, number];

export interface TextRendererMarkerRasterContext {
  /** Square output dimension in pixels. */
  readonly frameSize: number;
  /** Requested marker size in CSS pixels. */
  readonly size: number;
  /** Requested border width in CSS pixels. */
  readonly borderWidth: number;
  /** Straight-alpha linear RGBA fill color. */
  readonly fill: TextRendererMarkerColor;
  /** Straight-alpha linear RGBA border color. */
  readonly border: TextRendererMarkerColor;
}

/** Returns a frameSize-square premultiplied linear RGBA8 marker image. */
export type TextRendererMarkerShapeRasterizer = (context: TextRendererMarkerRasterContext) => Uint8Array;

export interface TextRendererAnnotationBackendOptions {
  surface: SurfaceContext;
  font: Font;
  defaultFontSize?: number;
  defaultColor?: string;
  coverageGamma?: number;
  shapeCacheSize?: number;
  shapingMode?: TextRendererShapingMode;
  /** Application marker rasterizers keyed by namespaced shape identifier. */
  markerShapes?: Readonly<Record<string, TextRendererMarkerShapeRasterizer>>;
}

export interface TextRendererAnnotationBackendStats {
  readonly requestedShapingMode: TextRendererShapingMode;
  readonly privateAdapterAvailable: boolean;
  readonly cacheHits: number;
  readonly cacheMisses: number;
  readonly publicShapes: number;
  readonly privateShapes: number;
  readonly privateFallbacks: number;
  readonly liveLabels: number;
  readonly spriteRendererActive: boolean;
  readonly textBuckets: number;
  readonly textDrawCalls: number;
  readonly liveLeaderLines: number;
  readonly leaderLineSprites: number;
  readonly leaderLineDrawCalls: number;
  readonly liveMarkers: number;
  readonly markerSprites: number;
  readonly markerDrawCalls: number;
}

export interface TextRendererAnnotationBackend extends AnnotationBackend {
  getStats(): TextRendererAnnotationBackendStats;
  supportsMarkerShape(shape: MarkerShape): boolean;
}

interface InkBounds {
  readonly minX: number;
  readonly minY: number;
  readonly maxX: number;
  readonly maxY: number;
}

interface ShapedLabel {
  readonly glyphs: readonly PlacedGlyph[];
  readonly pixelsPerFontUnit: number;
  readonly width: number;
  readonly height: number;
  readonly centerX: number;
  readonly centerY: number;
}

interface TextBucket {
  readonly zIndex: number;
  readonly data: TextData;
  readonly layer: TextLayer;
  resources: number;
}

interface TextResource {
  readonly kind: "text";
  disposed: boolean;
  bucket: TextBucket;
  run: GlyphRun;
  shaped: ShapedLabel;
  text: string;
  fontSize: number;
  zIndex: number;
  rendered: boolean;
  screenX: number;
  screenY: number;
  color: readonly [number, number, number, number];
  bounds: BackendBounds | null;
  leaderLine: LeaderLineResource | null;
}

interface MarkerResource {
  readonly kind: "marker";
  disposed: boolean;
  sprite: Sprite2DHandle;
  frame: number;
  size: number;
  opacity: number;
  rendered: boolean;
  screenX: number;
  screenY: number;
  bounds: BackendBounds | null;
}

type AnnotationResource = TextResource | MarkerResource;

type LeaderLineCap = "square" | "round";

interface LeaderLineResource {
  cap: LeaderLineCap;
  sprites: Sprite2DHandle[];
  color: readonly [number, number, number, number];
  width: number;
  visible: boolean;
}

interface SpriteRendererState {
  readonly atlas: SpriteAtlas;
  readonly lineLayer: Sprite2DLayer;
  readonly markerLayer: Sprite2DLayer;
  readonly renderer: SpriteRenderer;
  visibleLines: number;
  visibleMarkers: number;
}

interface MutableStats {
  cacheHits: number;
  cacheMisses: number;
  publicShapes: number;
  privateShapes: number;
  privateFallbacks: number;
  liveLabels: number;
  liveLeaderLines: number;
  leaderLineSprites: number;
  liveMarkers: number;
  markerSprites: number;
}

const CURVE_SET_ID: CurveSetId = "@litools/annotator/textrender";
const DEFAULT_FONT_SIZE = 16;
const DEFAULT_CACHE_SIZE = 512;
const SCALE_EPSILON = 0.001;
const MARKER_FRAME_SIZE = 64;
const BUILTIN_MARKER_SHAPES = new Set<MarkerShape>([
  "dot",
  "ring",
  "square",
  "diamond",
  "triangle",
  "cross",
  "pin"
]);

/**
 * Creates a GPU annotation backend using Babylon Lite TextRenderer and Sprite2D.
 * Create it after registering the scene so its non-clearing pass is drawn on top.
 * The backend owns its renderer and glyph resources, but not `surface` or `font`.
 */
export function createTextRendererAnnotationBackend(
  options: TextRendererAnnotationBackendOptions
): TextRendererAnnotationBackend {
  const defaultFontSize = options.defaultFontSize ?? DEFAULT_FONT_SIZE;
  const coverageGamma = options.coverageGamma ?? 1;
  const cacheLimit = options.shapeCacheSize ?? DEFAULT_CACHE_SIZE;
  const requestedMode = options.shapingMode ?? "public";
  const customMarkerShapes = createMarkerShapeRegistry(options.markerShapes);
  assertPositiveFinite(defaultFontSize, "Default font size");
  assertPositiveFinite(coverageGamma, "Coverage gamma");
  if (!Number.isInteger(cacheLimit) || cacheLimit < 0) {
    throw new AnnotatorError("Text shape cache size must be a non-negative integer");
  }

  const storage = createGlyphStorage();
  const renderer = createTextRenderer(options.surface, { layers: [], clear: false });
  registerTextRenderer(renderer);
  const buckets = new Map<number, TextBucket>();
  const resources = new Set<AnnotationResource>();
  const shapeCache = new Map<string, ShapedLabel>();
  const colorCache = new Map<string, readonly [number, number, number, number]>();
  const stats: MutableStats = {
    cacheHits: 0,
    cacheMisses: 0,
    publicShapes: 0,
    privateShapes: 0,
    privateFallbacks: 0,
    liveLabels: 0,
    liveLeaderLines: 0,
    leaderLineSprites: 0,
    liveMarkers: 0,
    markerSprites: 0
  };
  let privateAvailable = requestedMode === "guarded-private";
  let disposed = false;
  let viewportScale = 1;
  let spriteState: SpriteRendererState | null = null;
  const markerFrameCache = new Map<string, number>();
  const defaultColor = resolveColor(options.defaultColor ?? "#ffffff");

  const backend: TextRendererAnnotationBackend = {
    create(definition) {
      assertUsable();
      validateDefinition(definition, customMarkerShapes);
      if (definition.type === "marker") return createMarkerResource(definition);
      const text = definition.text ?? "";
      const fontSize = resolveFontSize(definition, defaultFontSize);
      const shaped = shape(text, fontSize);
      const color = resolveDefinitionColor(definition);
      const bucket = getBucket(definition.zIndex);
      const run = createRun(shaped, 0, 0, color, false);
      updateTextData(bucket.data, { update: "addRun", run });
      bucket.resources++;
      const resource: TextResource = {
        kind: "text",
        disposed: false,
        bucket,
        run,
        shaped,
        text,
        fontSize,
        zIndex: definition.zIndex,
        rendered: false,
        screenX: 0,
        screenY: 0,
        color,
        bounds: null,
        leaderLine: null
      };
      syncLeaderLineDefinition(resource, definition);
      resources.add(resource);
      stats.liveLabels++;
      return resource;
    },

    update(resource, update) {
      assertUsable();
      const target = requireResource(resource);
      validateDefinition(update, customMarkerShapes);
      if (target.kind === "marker") {
        updateMarkerResource(target, update);
        return;
      }
      if (update.type !== "label") throw new AnnotatorError("Annotation resource type cannot be changed");
      const text = update.text ?? "";
      const fontSize = resolveFontSize(update, defaultFontSize);
      const shaped = update.definitionChanged && (text !== target.text || fontSize !== target.fontSize)
        ? shape(text, fontSize)
        : target.shaped;
      const color = update.definitionChanged ? resolveDefinitionColor(update) : target.color;
      const rendered = update.rendered && update.screenPosition !== null;
      const screenX = update.screenPosition?.x ?? target.screenX;
      const screenY = update.screenPosition?.y ?? target.screenY;
      const nextRun = createRun(shaped, screenX, screenY, color, rendered);

      if (update.zIndex !== target.zIndex) {
        removeRun(target);
        const bucket = getBucket(update.zIndex);
        updateTextData(bucket.data, { update: "addRun", run: nextRun });
        bucket.resources++;
        target.bucket = bucket;
      } else {
        updateTextData(target.bucket.data, { update: "replaceRun", previous: target.run, run: nextRun });
      }

      target.run = nextRun;
      target.shaped = shaped;
      target.text = text;
      target.fontSize = fontSize;
      target.zIndex = update.zIndex;
      target.rendered = rendered;
      target.screenX = screenX;
      target.screenY = screenY;
      target.color = color;
      target.bounds = rendered ? centeredBounds(screenX, screenY, shaped.width, shaped.height) : null;
      if (update.definitionChanged) syncLeaderLineDefinition(target, update);
      updateLeaderLineGeometry(target, rendered ? update.leaderLineGeometry ?? null : null);
    },

    measure(resource) {
      assertUsable();
      return requireResource(resource).bounds;
    },

    setViewport(viewport) {
      assertUsable();
      viewportScale = resolveViewportScale(options.surface, viewport);
      for (const bucket of buckets.values()) bucket.layer.scale = viewportScale;
      if (spriteState) {
        spriteState.lineLayer.view.zoom = viewportScale;
        spriteState.markerLayer.view.zoom = viewportScale;
      }
    },

    disposeResource(resource) {
      if (!isResource(resource) || resource.disposed) return;
      if (resource.kind === "marker") {
        removeMarkerResource(resource);
        return;
      }
      removeRun(resource);
      removeLeaderLine(resource);
      resource.disposed = true;
      resource.bounds = null;
      resources.delete(resource);
      stats.liveLabels--;
    },

    dispose() {
      if (disposed) return;
      for (const resource of resources) resource.disposed = true;
      resources.clear();
      stats.liveLabels = 0;
      stats.liveLeaderLines = 0;
      stats.leaderLineSprites = 0;
      stats.liveMarkers = 0;
      stats.markerSprites = 0;
      disposeTextRenderer(renderer);
      if (spriteState) {
        disposeSpriteRenderer(spriteState.renderer);
        disposeSpriteAtlas(spriteState.atlas);
        spriteState = null;
      }
      for (const bucket of buckets.values()) disposeTextData(bucket.data);
      buckets.clear();
      disposeGlyphStorage(storage);
      shapeCache.clear();
      colorCache.clear();
      markerFrameCache.clear();
      disposed = true;
    },

    getStats() {
      return Object.freeze({
        requestedShapingMode: requestedMode,
        privateAdapterAvailable: privateAvailable,
        cacheHits: stats.cacheHits,
        cacheMisses: stats.cacheMisses,
        publicShapes: stats.publicShapes,
        privateShapes: stats.privateShapes,
        privateFallbacks: stats.privateFallbacks,
        liveLabels: stats.liveLabels,
        spriteRendererActive: spriteState !== null,
        textBuckets: buckets.size,
        textDrawCalls: buckets.size,
        liveLeaderLines: stats.liveLeaderLines,
        leaderLineSprites: stats.leaderLineSprites,
        leaderLineDrawCalls: spriteState && spriteState.visibleLines > 0 ? 1 : 0,
        liveMarkers: stats.liveMarkers,
        markerSprites: stats.markerSprites,
        markerDrawCalls: spriteState && spriteState.visibleMarkers > 0 ? 1 : 0
      });
    },

    supportsMarkerShape(shape) {
      return BUILTIN_MARKER_SHAPES.has(shape) || customMarkerShapes.has(shape);
    }
  };

  return backend;

  function assertUsable(): void {
    if (disposed) throw new AnnotatorError("TextRenderer annotation backend has been disposed");
  }

  function getBucket(zIndex: number): TextBucket {
    const existing = buckets.get(zIndex);
    if (existing) return existing;
    const data = createTextData(storage);
    const layer = createTextLayer(data, { order: zIndex, coverageGamma, scale: viewportScale });
    const bucket: TextBucket = { zIndex, data, layer, resources: 0 };
    buckets.set(zIndex, bucket);
    addTextRendererLayer(renderer, layer);
    return bucket;
  }

  function removeRun(resource: TextResource): void {
    const bucket = resource.bucket;
    updateTextData(bucket.data, { update: "removeRun", run: resource.run });
    bucket.resources--;
    if (bucket.resources !== 0) return;
    removeTextRendererLayer(renderer, bucket.layer);
    disposeTextData(bucket.data);
    buckets.delete(bucket.zIndex);
  }

  function ensureSpriteRenderer(): SpriteRendererState {
    if (spriteState) return spriteState;
    const atlas = createSpriteAtlas(options.surface);
    const lineLayer = createSprite2DLayer(atlas, {
      capacity: 64,
      blendMode: spriteBlendPremultiplied,
      pivot: [0.5, 0.5],
      order: 0,
      visible: false,
      view: { zoom: viewportScale }
    });
    const markerLayer = createSprite2DLayer(atlas, {
      capacity: 64,
      blendMode: spriteBlendPremultiplied,
      pivot: [0.5, 0.5],
      order: 1,
      visible: false,
      view: { zoom: viewportScale }
    });
    const spriteRenderer = createSpriteRenderer(options.surface, { layers: [lineLayer, markerLayer], clear: false });
    unregisterTextRenderer(renderer);
    registerSpriteRenderer(spriteRenderer);
    registerTextRenderer(renderer);
    spriteState = { atlas, lineLayer, markerLayer, renderer: spriteRenderer, visibleLines: 0, visibleMarkers: 0 };
    return spriteState;
  }

  function syncLeaderLineDefinition(
    resource: TextResource,
    definition: BackendAnnotationDefinition | BackendAnnotationUpdate
  ): void {
    const value = definition.leaderLine;
    if (!value) {
      removeLeaderLine(resource);
      return;
    }
    const cap = value.lineCap ?? "square";
    const width = value.width ?? 1;
    const opacity = value.opacity ?? 1;
    if (cap !== "square" && cap !== "round") {
      throw new AnnotatorError('Leader line cap must be "square" or "round"');
    }
    assertPositiveFinite(width, "Leader line width");
    if (!Number.isFinite(opacity) || opacity < 0 || opacity > 1) {
      throw new AnnotatorError("Leader line opacity must be between 0 and 1");
    }
    const base = resolveColor(value.color ?? definition.style.borderColor ?? definition.style.color ?? options.defaultColor ?? "#ffffff");
    const alpha = base[3] * opacity;
    const color = Object.freeze([base[0] * alpha, base[1] * alpha, base[2] * alpha, alpha] as const);
    let line = resource.leaderLine;
    if (!line || line.cap !== cap) {
      removeLeaderLine(resource);
      const count = cap === "round" ? 3 : 1;
      const state = ensureSpriteRenderer();
      const sprites = Array.from({ length: count }, (_, index) => addSprite2D(state.lineLayer, {
        positionPx: [0, 0],
        sizePx: [0, 0],
        frame: cap === "round" && index > 0 ? 1 : 0,
        color: [...color],
        visible: false
      }));
      line = { cap, sprites, color, width, visible: false };
      resource.leaderLine = line;
      stats.liveLeaderLines++;
      stats.leaderLineSprites += sprites.length;
    } else {
      line.color = color;
      line.width = width;
      for (const sprite of line.sprites) updateSprite2D(sprite, { color: [...color] });
    }
  }

  function updateLeaderLineGeometry(
    resource: TextResource,
    geometry: BackendAnnotationUpdate["leaderLineGeometry"] | null
  ): void {
    const line = resource.leaderLine;
    if (!line) return;
    if (!geometry) {
      setLeaderLineVisible(line, false);
      return;
    }
    const dx = geometry.end.x - geometry.start.x;
    const dy = geometry.end.y - geometry.start.y;
    const length = Math.hypot(dx, dy);
    if (!Number.isFinite(length) || length <= 0) {
      setLeaderLineVisible(line, false);
      return;
    }
    const rotation = Math.atan2(dy, dx);
    const midpoint: [number, number] = [
      (geometry.start.x + geometry.end.x) * 0.5,
      (geometry.start.y + geometry.end.y) * 0.5
    ];
    updateSprite2D(line.sprites[0]!, {
      positionPx: midpoint,
      sizePx: [length, line.width],
      rotation,
      color: [...line.color],
      visible: true
    });
    if (line.cap === "round") {
      updateSprite2D(line.sprites[1]!, {
        positionPx: [geometry.start.x, geometry.start.y],
        sizePx: [line.width, line.width],
        rotation: 0,
        color: [...line.color],
        visible: true
      });
      updateSprite2D(line.sprites[2]!, {
        positionPx: [geometry.end.x, geometry.end.y],
        sizePx: [line.width, line.width],
        rotation: 0,
        color: [...line.color],
        visible: true
      });
    }
    setLeaderLineVisible(line, true);
  }

  function setLeaderLineVisible(line: LeaderLineResource, visible: boolean): void {
    if (line.visible !== visible && spriteState) spriteState.visibleLines += visible ? 1 : -1;
    line.visible = visible;
    if (spriteState) spriteState.lineLayer.visible = spriteState.visibleLines > 0;
    if (!visible) {
      for (const sprite of line.sprites) updateSprite2D(sprite, { visible: false });
    }
  }

  function removeLeaderLine(resource: TextResource): void {
    const line = resource.leaderLine;
    if (!line) return;
    if (line.visible && spriteState) spriteState.visibleLines--;
    for (const sprite of line.sprites) removeSprite2D(sprite);
    stats.liveLeaderLines--;
    stats.leaderLineSprites -= line.sprites.length;
    resource.leaderLine = null;
    if (spriteState) spriteState.lineLayer.visible = spriteState.visibleLines > 0;
  }

  function createMarkerResource(definition: BackendAnnotationDefinition): MarkerResource {
    const size = definition.size ?? 12;
    const frame = resolveMarkerFrame(definition, size);
    const opacity = resolveMarkerOpacity(definition);
    const state = ensureSpriteRenderer();
    const sprite = addSprite2D(state.markerLayer, {
      positionPx: [0, 0],
      sizePx: [size, size],
      frame,
      color: [opacity, opacity, opacity, opacity],
      visible: false
    });
    const resource: MarkerResource = {
      kind: "marker",
      disposed: false,
      sprite,
      frame,
      size,
      opacity,
      rendered: false,
      screenX: 0,
      screenY: 0,
      bounds: null
    };
    resources.add(resource);
    stats.liveMarkers++;
    stats.markerSprites++;
    return resource;
  }

  function updateMarkerResource(resource: MarkerResource, update: BackendAnnotationUpdate): void {
    if (update.type !== "marker") throw new AnnotatorError("Annotation resource type cannot be changed");
    const size = update.size ?? 12;
    const frame = update.definitionChanged ? resolveMarkerFrame(update, size) : resource.frame;
    const opacity = update.definitionChanged ? resolveMarkerOpacity(update) : resource.opacity;
    const rendered = update.rendered && update.screenPosition !== null;
    const screenX = update.screenPosition?.x ?? resource.screenX;
    const screenY = update.screenPosition?.y ?? resource.screenY;
    updateSprite2D(resource.sprite, {
      positionPx: [screenX, screenY],
      sizePx: [size, size],
      frame,
      color: [opacity, opacity, opacity, opacity],
      visible: rendered
    });
    if (resource.rendered !== rendered && spriteState) spriteState.visibleMarkers += rendered ? 1 : -1;
    if (spriteState) spriteState.markerLayer.visible = spriteState.visibleMarkers > 0;
    resource.frame = frame;
    resource.size = size;
    resource.opacity = opacity;
    resource.rendered = rendered;
    resource.screenX = screenX;
    resource.screenY = screenY;
    resource.bounds = rendered ? centeredBounds(screenX, screenY, size, size) : null;
  }

  function removeMarkerResource(resource: MarkerResource): void {
    if (resource.rendered && spriteState) spriteState.visibleMarkers--;
    removeSprite2D(resource.sprite);
    resource.disposed = true;
    resource.rendered = false;
    resource.bounds = null;
    resources.delete(resource);
    stats.liveMarkers--;
    stats.markerSprites--;
    if (spriteState) spriteState.markerLayer.visible = spriteState.visibleMarkers > 0;
  }

  function resolveMarkerFrame(
    definition: BackendAnnotationDefinition | BackendAnnotationUpdate,
    size: number
  ): number {
    const shape = definition.shape ?? "dot";
    const borderWidth = definition.style.borderWidth ?? (shape === "ring" ? 2 : 0);
    const fill = shape !== "ring"
      ? resolveColor(definition.style.backgroundColor ?? definition.style.color ?? options.defaultColor ?? "#ffffff")
      : Object.freeze([0, 0, 0, 0] as const);
    const border = resolveColor(
      definition.style.borderColor ?? definition.style.color ?? options.defaultColor ?? "#ffffff"
    );
    const borderRatio = borderWidth / size;
    const rasterizer = customMarkerShapes.get(shape);
    const key = [shape, rasterizer ? size : "normalized", borderRatio, ...fill, ...border].join("|");
    const cached = markerFrameCache.get(key);
    if (cached !== undefined) return cached;
    const state = ensureSpriteRenderer();
    const pixels = rasterizer
      ? rasterizeCustomMarker(shape, rasterizer, size, borderWidth, fill, border)
      : createMarkerPixels(shape, size, borderWidth, fill, border);
    let frame: number | undefined;
    try {
      frame = appendSpriteAtlasFrames(options.surface.engine, state.atlas, [{
        pixels,
        width: MARKER_FRAME_SIZE,
        height: MARKER_FRAME_SIZE,
        name: `marker-${markerFrameCache.size}`
      }])[0];
    } catch (error) {
      throw new AnnotatorError(`GPU marker atlas capacity was exceeded: ${String(error)}`);
    }
    if (frame === undefined) throw new AnnotatorError("Babylon Lite did not append the GPU marker frame");
    markerFrameCache.set(key, frame);
    return frame;
  }

  function resolveMarkerOpacity(definition: BackendAnnotationDefinition | BackendAnnotationUpdate): number {
    const opacity = definition.style.opacity ?? 1;
    if (!Number.isFinite(opacity) || opacity < 0 || opacity > 1) {
      throw new AnnotatorError("Marker opacity must be between 0 and 1");
    }
    return opacity;
  }

  function shape(text: string, fontSize: number): ShapedLabel {
    const key = `${fontSize}\u0000${text}`;
    const cached = shapeCache.get(key);
    if (cached) {
      stats.cacheHits++;
      shapeCache.delete(key);
      shapeCache.set(key, cached);
      return cached;
    }
    stats.cacheMisses++;
    let shaped: ShapedLabel;
    if (privateAvailable) {
      try {
        shaped = finishShape(guardedPrivateLayoutText(options.font, text, fontSize));
        stats.privateShapes++;
      } catch {
        privateAvailable = false;
        stats.privateFallbacks++;
        shaped = publicShape(text, fontSize);
      }
    } else {
      shaped = publicShape(text, fontSize);
    }
    if (cacheLimit > 0) {
      shapeCache.set(key, shaped);
      while (shapeCache.size > cacheLimit) {
        const oldest = shapeCache.keys().next().value as string | undefined;
        if (oldest === undefined) break;
        shapeCache.delete(oldest);
      }
    }
    return shaped;
  }

  function publicShape(text: string, fontSize: number): ShapedLabel {
    const temporary = createDefaultTextData(options.font, fontSize, text);
    stats.publicShapes++;
    try {
      const run = temporary.runs[0];
      if (!run) throw new AnnotatorError("Babylon Lite did not produce a text run");
      return finishShape({
        glyphs: run.glyphs,
        pixelsPerFontUnit: run.pixelsPerFontUnit,
        width: temporary.width,
        height: temporary.height
      });
    } finally {
      disposeDefaultTextData(temporary);
    }
  }

  function finishShape(layout: PrivateTextLayoutResult): ShapedLabel {
    const ids = new Set<number>();
    for (const glyph of layout.glyphs) ids.add(glyph.glyphId);
    const curves = new Map<number, GlyphCurves>();
    extractGlyphCurves(options.font, ids, curves);
    updateGlyphStorage(storage, CURVE_SET_ID, curves);
    const ink = calculateInkBounds(layout.glyphs, layout.pixelsPerFontUnit, curves);
    const inkWidth = ink ? ink.maxX - ink.minX : 0;
    const inkHeight = ink ? ink.maxY - ink.minY : 0;
    return Object.freeze({
      glyphs: Object.freeze(layout.glyphs.map(cloneGlyph)),
      pixelsPerFontUnit: layout.pixelsPerFontUnit,
      width: Math.max(layout.width, inkWidth),
      height: Math.max(layout.height, inkHeight),
      centerX: ink ? (ink.minX + ink.maxX) * 0.5 : layout.width * 0.5,
      centerY: ink ? (ink.minY + ink.maxY) * 0.5 : 0
    });
  }

  function resolveDefinitionColor(definition: BackendAnnotationDefinition | BackendAnnotationUpdate): readonly [number, number, number, number] {
    const base = definition.style.color ? resolveColor(definition.style.color) : defaultColor;
    const opacity = definition.style.opacity ?? 1;
    if (!Number.isFinite(opacity) || opacity < 0 || opacity > 1) {
      throw new AnnotatorError("Text opacity must be between 0 and 1");
    }
    return Object.freeze([base[0], base[1], base[2], base[3] * opacity] as const);
  }

  function resolveColor(value: string): readonly [number, number, number, number] {
    const cached = colorCache.get(value);
    if (cached) return cached;
    const parsed = parseCssColor(value);
    colorCache.set(value, parsed);
    return parsed;
  }
}

function validateDefinition(
  definition: BackendAnnotationDefinition | BackendAnnotationUpdate,
  customMarkerShapes: ReadonlyMap<string, TextRendererMarkerShapeRasterizer>
): void {
  if (definition.type === "marker") {
    const size = definition.size ?? 12;
    assertPositiveFinite(size, "Marker size");
    const shape = definition.shape ?? "dot";
    if (typeof shape !== "string" || shape.length === 0) {
      throw new AnnotatorError("Marker shape must be a non-empty string");
    }
    if (!BUILTIN_MARKER_SHAPES.has(shape) && !customMarkerShapes.has(shape)) {
      throw new AnnotatorError(`Unknown GPU marker shape "${shape}"`);
    }
    const borderWidth = definition.style.borderWidth ?? (definition.shape === "ring" ? 2 : 0);
    if (!Number.isFinite(borderWidth) || borderWidth < 0) {
      throw new AnnotatorError("Marker border width must be a non-negative finite number");
    }
    const unsupportedMarker: ReadonlyArray<keyof BackendAnnotationDefinition["style"]> = [
      "fontSize",
      "fontWeight",
      "borderRadius",
      "padding",
      "className"
    ];
    for (const key of unsupportedMarker) {
      if (definition.style[key] !== undefined) {
        throw new AnnotatorError(`TextRenderer annotation backend does not support marker style.${key}`);
      }
    }
    if (definition.leaderLine !== undefined) {
      throw new AnnotatorError("GPU markers do not support leader lines");
    }
    if ((definition.style.opacityTransitionDuration ?? 0) !== 0) {
      throw new AnnotatorError("TextRenderer annotation backend does not support opacity transitions");
    }
    return;
  }
  if (definition.leaderLine) {
    const { lineCap = "square", width = 1, opacity = 1 } = definition.leaderLine;
    if (lineCap !== "square" && lineCap !== "round") {
      throw new AnnotatorError('Leader line cap must be "square" or "round"');
    }
    assertPositiveFinite(width, "Leader line width");
    if (!Number.isFinite(opacity) || opacity < 0 || opacity > 1) {
      throw new AnnotatorError("Leader line opacity must be between 0 and 1");
    }
  }
  const unsupported: ReadonlyArray<keyof BackendAnnotationDefinition["style"]> = [
    "backgroundColor",
    "fontWeight",
    "borderColor",
    "borderWidth",
    "borderRadius",
    "padding",
    "className"
  ];
  for (const key of unsupported) {
    if (definition.style[key] !== undefined) {
      throw new AnnotatorError(`TextRenderer annotation backend does not support style.${key}`);
    }
  }
  if ((definition.style.opacityTransitionDuration ?? 0) !== 0) {
    throw new AnnotatorError("TextRenderer annotation backend does not support opacity transitions");
  }
}

function createSpriteAtlas(surface: SurfaceContext): SpriteAtlas {
  const square = new Uint8Array([255, 255, 255, 255]);
  const circleSize = 16;
  const circle = new Uint8Array(circleSize * circleSize * 4);
  const center = circleSize * 0.5;
  const radius = circleSize * 0.5 - 0.5;
  for (let y = 0; y < circleSize; y++) {
    for (let x = 0; x < circleSize; x++) {
      const distance = Math.hypot(x + 0.5 - center, y + 0.5 - center);
      const alpha = Math.max(0, Math.min(1, radius + 0.5 - distance));
      const byte = Math.round(alpha * 255);
      const offset = (y * circleSize + x) * 4;
      // The atlas is consumed with premultiplied-alpha blending.
      circle[offset] = byte;
      circle[offset + 1] = byte;
      circle[offset + 2] = byte;
      circle[offset + 3] = byte;
    }
  }
  return createSpriteAtlasFromFrames(surface.engine, [
    { pixels: square, width: 1, height: 1, name: "square" },
    { pixels: circle, width: circleSize, height: circleSize, name: "round" }
  ], {
    paddingPx: 1,
    sampling: "linear",
    premultipliedAlpha: true,
    capacityPx: [1024, 1024]
  });
}

function createMarkerPixels(
  shape: MarkerShape,
  size: number,
  borderWidth: number,
  fill: readonly [number, number, number, number],
  border: readonly [number, number, number, number]
): Uint8Array {
  const pixels = new Uint8Array(MARKER_FRAME_SIZE * MARKER_FRAME_SIZE * 4);
  const borderRatio = Math.min(0.5, borderWidth / size);
  const radius = 0.47;
  const innerRadius = Math.max(0, radius - borderRatio);
  const samples = [-0.25, 0.25] as const;
  for (let y = 0; y < MARKER_FRAME_SIZE; y++) {
    for (let x = 0; x < MARKER_FRAME_SIZE; x++) {
      let outerCoverage = 0;
      let innerCoverage = 0;
      for (const sampleY of samples) {
        for (const sampleX of samples) {
          const normalizedX = (x + 0.5 + sampleX) / MARKER_FRAME_SIZE - 0.5;
          const normalizedY = (y + 0.5 + sampleY) / MARKER_FRAME_SIZE - 0.5;
          if (containsMarkerPoint(shape, normalizedX, normalizedY, radius)) outerCoverage += 0.25;
          if (containsMarkerPoint(shape, normalizedX, normalizedY, innerRadius)) innerCoverage += 0.25;
        }
      }
      const offset = (y * MARKER_FRAME_SIZE + x) * 4;
      if (shape === "ring") {
        writePremultipliedPixel(pixels, offset, border, Math.max(0, outerCoverage - innerCoverage));
        continue;
      }
      const fillCoverage = borderWidth > 0 ? innerCoverage : outerCoverage;
      const fillAlpha = fill[3] * fillCoverage;
      const borderAlpha = borderWidth > 0 ? border[3] * outerCoverage * (1 - fillAlpha) : 0;
      const alpha = fillAlpha + borderAlpha;
      pixels[offset] = toColorByte(fill[0] * fillAlpha + border[0] * borderAlpha);
      pixels[offset + 1] = toColorByte(fill[1] * fillAlpha + border[1] * borderAlpha);
      pixels[offset + 2] = toColorByte(fill[2] * fillAlpha + border[2] * borderAlpha);
      pixels[offset + 3] = toColorByte(alpha);
    }
  }
  return pixels;
}

function containsMarkerPoint(shape: MarkerShape, x: number, y: number, radius: number): boolean {
  if (radius <= 0) return false;
  switch (shape) {
    case "dot":
    case "ring":
      return x * x + y * y <= radius * radius;
    case "square":
      return Math.abs(x) <= radius && Math.abs(y) <= radius;
    case "diamond":
      return Math.abs(x) + Math.abs(y) <= radius;
    case "triangle":
      return pointInTriangle(x, y, 0, -radius, radius, radius, -radius, radius);
    case "cross": {
      const arm = radius * 0.34;
      return Math.abs(x) <= radius && Math.abs(y) <= radius && (Math.abs(x) <= arm || Math.abs(y) <= arm);
    }
    case "pin": {
      const headRadius = radius * 0.62;
      const headY = -radius * 0.28;
      const inHead = x * x + (y - headY) * (y - headY) <= headRadius * headRadius;
      return inHead || pointInTriangle(x, y, -headRadius * 0.72, 0, headRadius * 0.72, 0, 0, radius);
    }
    default:
      return false;
  }
}

function pointInTriangle(
  x: number,
  y: number,
  ax: number,
  ay: number,
  bx: number,
  by: number,
  cx: number,
  cy: number
): boolean {
  const d1 = (x - bx) * (ay - by) - (ax - bx) * (y - by);
  const d2 = (x - cx) * (by - cy) - (bx - cx) * (y - cy);
  const d3 = (x - ax) * (cy - ay) - (cx - ax) * (y - ay);
  return (d1 >= 0 && d2 >= 0 && d3 >= 0) || (d1 <= 0 && d2 <= 0 && d3 <= 0);
}

function createMarkerShapeRegistry(
  definitions: TextRendererAnnotationBackendOptions["markerShapes"]
): ReadonlyMap<string, TextRendererMarkerShapeRasterizer> {
  const registry = new Map<string, TextRendererMarkerShapeRasterizer>();
  if (!definitions) return registry;
  for (const [name, rasterizer] of Object.entries(definitions)) {
    if (name.length === 0) throw new AnnotatorError("Custom GPU marker shape name must be non-empty");
    if (BUILTIN_MARKER_SHAPES.has(name)) {
      throw new AnnotatorError(`Custom GPU marker shape cannot replace built-in shape "${name}"`);
    }
    if (typeof rasterizer !== "function") {
      throw new AnnotatorError(`Custom GPU marker shape "${name}" must be a rasterizer function`);
    }
    registry.set(name, rasterizer);
  }
  return registry;
}

function rasterizeCustomMarker(
  shape: string,
  rasterizer: TextRendererMarkerShapeRasterizer,
  size: number,
  borderWidth: number,
  fill: TextRendererMarkerColor,
  border: TextRendererMarkerColor
): Uint8Array {
  let pixels: Uint8Array;
  try {
    pixels = rasterizer(Object.freeze({
      frameSize: MARKER_FRAME_SIZE,
      size,
      borderWidth,
      fill,
      border
    }));
  } catch (error) {
    throw new AnnotatorError(`Custom GPU marker shape "${shape}" failed to rasterize: ${String(error)}`);
  }
  const expectedLength = MARKER_FRAME_SIZE * MARKER_FRAME_SIZE * 4;
  if (!(pixels instanceof Uint8Array) || pixels.length !== expectedLength) {
    throw new AnnotatorError(
      `Custom GPU marker shape "${shape}" must return a Uint8Array of length ${expectedLength}`
    );
  }
  return pixels;
}

function writePremultipliedPixel(
  pixels: Uint8Array,
  offset: number,
  color: readonly [number, number, number, number],
  coverage: number
): void {
  const alpha = color[3] * coverage;
  pixels[offset] = toColorByte(color[0] * alpha);
  pixels[offset + 1] = toColorByte(color[1] * alpha);
  pixels[offset + 2] = toColorByte(color[2] * alpha);
  pixels[offset + 3] = toColorByte(alpha);
}

function toColorByte(value: number): number {
  return Math.round(clamp01(value) * 255);
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function resolveFontSize(
  definition: BackendAnnotationDefinition | BackendAnnotationUpdate,
  defaultFontSize: number
): number {
  const value = definition.style.fontSize ?? defaultFontSize;
  assertPositiveFinite(value, "Text font size");
  return value;
}

function createRun(
  shaped: ShapedLabel,
  screenX: number,
  screenY: number,
  color: readonly [number, number, number, number],
  rendered: boolean
): GlyphRun {
  const alpha = rendered ? color[3] : 0;
  const glyphs = shaped.glyphs.map((glyph) => Object.freeze({
    glyphId: glyph.glyphId,
    x: glyph.x - shaped.centerX + screenX,
    y: glyph.y - shaped.centerY - screenY
  }));
  return Object.freeze({
    curveSet: CURVE_SET_ID,
    glyphs,
    pixelsPerFontUnit: shaped.pixelsPerFontUnit,
    // Lite's TextRenderer uses premultiplied-alpha blending. Zero RGB as well
    // as alpha for hidden runs, otherwise alpha-zero text remains additive.
    defaultColor: Object.freeze([color[0] * alpha, color[1] * alpha, color[2] * alpha, alpha] as const)
  });
}

function calculateInkBounds(
  glyphs: readonly PlacedGlyph[],
  scale: number,
  curves: ReadonlyMap<number, GlyphCurves>
): InkBounds | null {
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (const glyph of glyphs) {
    const curve = curves.get(glyph.glyphId);
    if (!curve) continue;
    minX = Math.min(minX, glyph.x + curve.bounds.xMin * scale);
    minY = Math.min(minY, glyph.y + curve.bounds.yMin * scale);
    maxX = Math.max(maxX, glyph.x + curve.bounds.xMax * scale);
    maxY = Math.max(maxY, glyph.y + curve.bounds.yMax * scale);
  }
  return Number.isFinite(minX) ? { minX, minY, maxX, maxY } : null;
}

function cloneGlyph(glyph: PlacedGlyph): PlacedGlyph {
  return Object.freeze({
    glyphId: glyph.glyphId,
    x: glyph.x,
    y: glyph.y,
    ...(glyph.color ? { color: Object.freeze([...glyph.color] as [number, number, number, number]) } : {})
  });
}

function centeredBounds(x: number, y: number, width: number, height: number): BackendBounds {
  return { x: x - width * 0.5, y: y - height * 0.5, width, height };
}

function resolveViewportScale(surface: SurfaceContext, viewport: AnnotationViewport): number {
  if (viewport.width <= 0 || viewport.height <= 0) return 1;
  const x = surface.canvas.width / viewport.width;
  const y = surface.canvas.height / viewport.height;
  if (!Number.isFinite(x) || !Number.isFinite(y) || x <= 0 || y <= 0) return 1;
  const relativeDifference = Math.abs(x - y) / Math.max(x, y);
  if (relativeDifference > SCALE_EPSILON) {
    throw new AnnotatorError("TextRenderer backend requires uniform canvas backing-store scale");
  }
  return (x + y) * 0.5;
}

function parseCssColor(value: string): readonly [number, number, number, number] {
  const hex = parseHexColor(value.trim());
  if (hex) return toLinearColor(hex);
  if (typeof document === "undefined") {
    throw new AnnotatorError(`Unsupported CSS color '${value}'`);
  }
  if (typeof CSS !== "undefined" && !CSS.supports("color", value)) {
    throw new AnnotatorError(`Invalid CSS color '${value}'`);
  }
  const canvas = document.createElement("canvas");
  canvas.width = 1;
  canvas.height = 1;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) throw new AnnotatorError("CSS color parsing requires Canvas 2D");
  context.clearRect(0, 0, 1, 1);
  context.fillStyle = value;
  context.fillRect(0, 0, 1, 1);
  const pixel = context.getImageData(0, 0, 1, 1).data;
  return toLinearColor([pixel[0]!, pixel[1]!, pixel[2]!, pixel[3]!]);
}

function parseHexColor(value: string): readonly [number, number, number, number] | null {
  const match = /^#([\da-f]{3}|[\da-f]{4}|[\da-f]{6}|[\da-f]{8})$/i.exec(value);
  const digits = match?.[1];
  if (!digits) return null;
  if (digits.length === 3 || digits.length === 4) {
    return [
      parseInt(digits[0]! + digits[0]!, 16),
      parseInt(digits[1]! + digits[1]!, 16),
      parseInt(digits[2]! + digits[2]!, 16),
      digits.length === 4 ? parseInt(digits[3]! + digits[3]!, 16) : 255
    ];
  }
  return [
    parseInt(digits.slice(0, 2), 16),
    parseInt(digits.slice(2, 4), 16),
    parseInt(digits.slice(4, 6), 16),
    digits.length === 8 ? parseInt(digits.slice(6, 8), 16) : 255
  ];
}

function toLinearColor(bytes: readonly [number, number, number, number]): readonly [number, number, number, number] {
  return Object.freeze([
    srgbByteToLinear(bytes[0]),
    srgbByteToLinear(bytes[1]),
    srgbByteToLinear(bytes[2]),
    bytes[3] / 255
  ] as const);
}

function assertPositiveFinite(value: number, name: string): void {
  if (!Number.isFinite(value) || value <= 0) throw new AnnotatorError(`${name} must be finite and greater than zero`);
}

function requireResource(resource: unknown): AnnotationResource {
  if (!isResource(resource) || resource.disposed) {
    throw new AnnotatorError("Unknown or disposed TextRenderer annotation resource");
  }
  return resource;
}

function isResource(resource: unknown): resource is AnnotationResource {
  if (typeof resource !== "object" || resource === null || !("disposed" in resource) || !("kind" in resource)) return false;
  const kind = (resource as { kind?: unknown }).kind;
  return kind === "text"
    ? "run" in resource && "bucket" in resource
    : kind === "marker" && "sprite" in resource;
}
