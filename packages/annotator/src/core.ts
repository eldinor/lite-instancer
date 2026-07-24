import {
  getCameraPosition,
  getViewProjectionMatrix,
  resolveCameraViewport,
} from "@babylonjs/lite";
import { copyVec2, copyVec3, resolveAnchor, storeAnchor, type StoredAnchor } from "./anchors.js";
import { AnnotatorError } from "./error.js";
import { projectAnnotationPosition } from "./projection.js";
import type {
  AnnotationBackend,
  AnnotationHandle,
  AnnotationHiddenReason,
  AnnotationId,
  AnnotationLayer,
  AnnotationLayerOptions,
  AnnotationSnapshot,
  AnnotationStyle,
  BackendAnnotationDefinition,
  BackendAnnotationUpdate,
  LabelHandle,
  LabelOptions,
  LabelPatch,
  MarkerHandle,
  MarkerOptions,
  MarkerPatch,
  MarkerShape,
  SupportedAnnotationAnchor
} from "./types.js";

interface CommonState {
  readonly handle: AnnotationHandle;
  readonly layer: LayerState;
  readonly resource: unknown;
  anchor: StoredAnchor;
  visible: boolean;
  zIndex: number;
  worldOffset: Float64Array;
  screenOffset: Float64Array;
  minDistance: number | undefined;
  maxDistance: number | undefined;
  hideWhenOffscreen: boolean;
  clampToViewport: boolean;
  style: AnnotationStyle;
  ariaLabel: string | undefined;
  role: string | undefined;
  disposed: boolean;
  definitionDirty: boolean;
  snapshot: AnnotationSnapshot;
  readonly positionScratch: Float32Array;
  readonly worldScratch: Float32Array;
}

interface LabelState extends CommonState {
  kind: "label";
  textSource: string | (() => string);
  text: string;
}

interface MarkerState extends CommonState {
  kind: "marker";
  shape: MarkerShape;
  size: number;
}

type AnnotationState = LabelState | MarkerState;

interface LayerState {
  readonly handle: AnnotationLayer;
  readonly options: AnnotationLayerOptions;
  readonly annotations: Map<AnnotationId, AnnotationState>;
  readonly backend: AnnotationBackend;
  disposed: boolean;
  nextId: number;
  rafId: number | undefined;
  resizeObserver: ResizeObserver | undefined;
  readonly cameraPositionScratch: Float64Array;
}

const layerStates = new WeakMap<AnnotationLayer, LayerState>();
const annotationStates = new WeakMap<AnnotationHandle, AnnotationState>();

export function createAnnotationLayer(options: AnnotationLayerOptions): AnnotationLayer {
  if (options.updateMode === "raf" && typeof requestAnimationFrame !== "function") {
    throw new AnnotatorError("RAF update mode requires requestAnimationFrame");
  }
  const handle = Object.freeze({}) as AnnotationLayer;
  const state: LayerState = {
    handle,
    options,
    annotations: new Map(),
    backend: options.backend,
    disposed: false,
    nextId: 1,
    rafId: undefined,
    resizeObserver: undefined,
    cameraPositionScratch: new Float64Array(3)
  };
  layerStates.set(handle, state);
  if (typeof ResizeObserver === "function") {
    state.resizeObserver = new ResizeObserver(() => {
      if (!state.disposed) updateLayer(state);
    });
    state.resizeObserver.observe(options.canvas);
  }
  if (options.updateMode === "raf") {
    const frame = (): void => {
      if (state.disposed) return;
      updateLayer(state);
      state.rafId = requestAnimationFrame(frame);
    };
    state.rafId = requestAnimationFrame(frame);
  }
  return handle;
}

export function createLabel(layer: AnnotationLayer, options: LabelOptions): LabelHandle {
  const layerState = requireLayer(layer);
  const id = nextId(layerState);
  const handle = Object.freeze({ id, type: "label" as const }) as LabelHandle;
  const text = evaluateText(options.text);
  const definition = createDefinition(id, "label", options, { text });
  const state = createCommonState(layerState, handle, options, definition) as LabelState;
  state.kind = "label";
  state.textSource = options.text;
  state.text = text;
  registerState(layerState, state);
  return handle;
}

export function createMarker(layer: AnnotationLayer, options: MarkerOptions): MarkerHandle {
  const layerState = requireLayer(layer);
  const id = nextId(layerState);
  const handle = Object.freeze({ id, type: "marker" as const }) as MarkerHandle;
  const shape = options.shape ?? "dot";
  const size = options.size ?? 12;
  assertPositive(size, "Marker size");
  const definition = createDefinition(id, "marker", options, { shape, size });
  const state = createCommonState(layerState, handle, options, definition) as MarkerState;
  state.kind = "marker";
  state.shape = shape;
  state.size = size;
  registerState(layerState, state);
  return handle;
}

export function updateLabel(label: LabelHandle, patch: LabelPatch): void {
  const state = requireAnnotation(label, "label");
  applyCommonPatch(state, patch);
  if (patch.text !== undefined) {
    state.textSource = patch.text;
    state.text = evaluateText(patch.text);
    state.definitionDirty = true;
  }
  if ("ariaLabel" in patch) state.ariaLabel = patch.ariaLabel;
  if ("role" in patch) state.role = patch.role;
}

export function updateMarker(marker: MarkerHandle, patch: MarkerPatch): void {
  const state = requireAnnotation(marker, "marker");
  applyCommonPatch(state, patch);
  if (patch.shape !== undefined) {
    state.shape = patch.shape;
    state.definitionDirty = true;
  }
  if (patch.size !== undefined) {
    assertPositive(patch.size, "Marker size");
    state.size = patch.size;
    state.definitionDirty = true;
  }
}

export function setAnnotationVisible(annotation: AnnotationHandle, visible: boolean): void {
  requireAnnotation(annotation).visible = visible;
}

export function setAnnotationAnchor(annotation: AnnotationHandle, anchor: SupportedAnnotationAnchor): void {
  requireAnnotation(annotation).anchor = storeAnchor(anchor);
}

export function invalidateAnnotation(annotation: AnnotationHandle): void {
  const state = requireAnnotation(annotation);
  if (state.kind === "label" && typeof state.textSource === "function") {
    state.text = evaluateText(state.textSource);
  }
  state.definitionDirty = true;
}

export function invalidateAnnotationLayer(layer: AnnotationLayer): void {
  const state = requireLayer(layer);
  for (const annotation of state.annotations.values()) invalidateAnnotation(annotation.handle);
}

export function updateAnnotationLayer(layer: AnnotationLayer): void {
  updateLayer(requireLayer(layer));
}

export function getAnnotationSnapshot(annotation: AnnotationHandle): AnnotationSnapshot {
  return requireAnnotation(annotation).snapshot;
}

export function disposeAnnotation(annotation: AnnotationHandle): void {
  const state = annotationStates.get(annotation);
  if (!state || state.disposed) return;
  state.layer.annotations.delete(annotation.id);
  state.layer.backend.disposeResource(state.resource);
  state.disposed = true;
}

export function disposeAnnotationLayer(layer: AnnotationLayer): void {
  const state = layerStates.get(layer);
  if (!state || state.disposed) return;
  if (state.rafId !== undefined && typeof cancelAnimationFrame === "function") {
    cancelAnimationFrame(state.rafId);
    state.rafId = undefined;
  }
  state.resizeObserver?.disconnect();
  state.resizeObserver = undefined;
  for (const annotation of Array.from(state.annotations.values())) disposeAnnotation(annotation.handle);
  state.backend.dispose();
  state.disposed = true;
}

function createCommonState(
  layer: LayerState,
  handle: AnnotationHandle,
  options: LabelOptions | MarkerOptions,
  definition: BackendAnnotationDefinition
): CommonState {
  validateDistances(options.minDistance, options.maxDistance);
  const resource = layer.backend.create(definition);
  return {
    handle,
    layer,
    resource,
    anchor: storeAnchor(options.anchor),
    visible: options.visible ?? true,
    zIndex: options.zIndex ?? 0,
    worldOffset: copyVec3(options.worldOffset),
    screenOffset: copyVec2(options.screenOffset),
    minDistance: options.minDistance,
    maxDistance: options.maxDistance,
    hideWhenOffscreen: options.hideWhenOffscreen ?? true,
    clampToViewport: options.clampToViewport ?? false,
    style: cloneStyle(options.style),
    ariaLabel: "ariaLabel" in options ? options.ariaLabel : undefined,
    role: "role" in options ? options.role : undefined,
    disposed: false,
    definitionDirty: true,
    snapshot: createSnapshot(handle, false, "anchor-unavailable", options.visible ?? true),
    positionScratch: new Float32Array(3),
    worldScratch: new Float32Array(3)
  };
}

function registerState(layer: LayerState, state: AnnotationState): void {
  layer.annotations.set(state.handle.id, state);
  annotationStates.set(state.handle, state);
}

function updateLayer(layer: LayerState): void {
  assertLayerUsable(layer);
  const canvasRect = layer.options.canvas.getBoundingClientRect();
  const width = canvasRect.width || layer.options.canvas.clientWidth || layer.options.canvas.width;
  const height = canvasRect.height || layer.options.canvas.clientHeight || layer.options.canvas.height;
  layer.backend.setViewport({ left: canvasRect.left, top: canvasRect.top, width, height });
  if (width <= 0 || height <= 0) {
    for (const annotation of layer.annotations.values()) hideAnnotation(annotation, "offscreen");
    return;
  }
  const pixelViewport = resolveCameraViewport(layer.options.camera, width, height);
  const cameraViewport = {
    left: pixelViewport.x,
    top: pixelViewport.y,
    width: pixelViewport.width,
    height: pixelViewport.height
  };
  const aspect = cameraViewport.height > 0 ? cameraViewport.width / cameraViewport.height : width / height;
  const viewProjection = getViewProjectionMatrix(layer.options.camera, aspect);
  const camera = getCameraPosition(layer.options.camera);
  layer.cameraPositionScratch[0] = camera.x;
  layer.cameraPositionScratch[1] = camera.y;
  layer.cameraPositionScratch[2] = camera.z;
  const padding = layer.options.viewportPadding ?? 8;

  for (const annotation of layer.annotations.values()) {
    if (!annotation.visible) {
      hideAnnotation(annotation, "none");
      continue;
    }
    const resolution = resolveAnchor(annotation.anchor, annotation.positionScratch);
    if (!resolution.available || !resolution.position) {
      hideAnnotation(annotation, "anchor-unavailable");
      continue;
    }
    if (!resolution.targetVisible) {
      hideAnnotation(annotation, "target-hidden");
      continue;
    }
    annotation.worldScratch[0] = (annotation.positionScratch[0] ?? 0) + annotation.worldOffset[0]!;
    annotation.worldScratch[1] = (annotation.positionScratch[1] ?? 0) + annotation.worldOffset[1]!;
    annotation.worldScratch[2] = (annotation.positionScratch[2] ?? 0) + annotation.worldOffset[2]!;
    const projection = projectAnnotationPosition({
      position: annotation.worldScratch,
      viewProjection,
      viewport: cameraViewport,
      cameraPosition: layer.cameraPositionScratch
    });
    if (
      (annotation.minDistance !== undefined && projection.distance < annotation.minDistance) ||
      (annotation.maxDistance !== undefined && projection.distance > annotation.maxDistance)
    ) {
      hideAnnotation(annotation, "distance", projection.depth, annotation.worldScratch);
      continue;
    }
    if (projection.behindCamera) {
      hideAnnotation(annotation, "behind-camera", projection.depth, annotation.worldScratch);
      continue;
    }
    if (projection.offscreen && annotation.hideWhenOffscreen && !annotation.clampToViewport) {
      hideAnnotation(annotation, "offscreen", projection.depth, annotation.worldScratch);
      continue;
    }

    const raw = {
      x: projection.screenPosition.x + annotation.screenOffset[0]!,
      y: projection.screenPosition.y + annotation.screenOffset[1]!
    };
    let final = raw;
    updateBackend(annotation, true, final);
    let measured = annotation.layer.backend.measure(annotation.resource);
    if (annotation.clampToViewport) {
      const halfWidth = (measured?.width ?? 0) * 0.5;
      const halfHeight = (measured?.height ?? 0) * 0.5;
      final = {
        x: clamp(raw.x, cameraViewport.left + padding + halfWidth, cameraViewport.left + cameraViewport.width - padding - halfWidth),
        y: clamp(raw.y, cameraViewport.top + padding + halfHeight, cameraViewport.top + cameraViewport.height - padding - halfHeight)
      };
      if (final.x !== raw.x || final.y !== raw.y) {
        updateBackend(annotation, true, final);
        measured = annotation.layer.backend.measure(annotation.resource);
      }
    }
    annotation.snapshot = Object.freeze({
      id: annotation.handle.id,
      type: annotation.handle.type,
      requestedVisible: true,
      rendered: true,
      hiddenReason: "none",
      worldPosition: freezeVec3(annotation.worldScratch),
      screenPosition: Object.freeze(final),
      unclampedScreenPosition: Object.freeze(raw),
      depth: projection.depth,
      bounds: measured ? createDomRect(measured.x, measured.y, measured.width, measured.height) : null
    });
    annotation.definitionDirty = false;
  }
}

function hideAnnotation(
  annotation: AnnotationState,
  reason: AnnotationHiddenReason,
  depth: number | null = null,
  world?: ArrayLike<number>
): void {
  updateBackend(annotation, false, null);
  annotation.snapshot = Object.freeze({
    id: annotation.handle.id,
    type: annotation.handle.type,
    requestedVisible: annotation.visible,
    rendered: false,
    hiddenReason: reason,
    worldPosition: world ? freezeVec3(world) : null,
    screenPosition: null,
    unclampedScreenPosition: null,
    depth,
    bounds: null
  });
  annotation.definitionDirty = false;
}

function updateBackend(
  annotation: AnnotationState,
  rendered: boolean,
  screenPosition: Readonly<{ x: number; y: number }> | null
): void {
  const update: BackendAnnotationUpdate = {
    ...definitionForState(annotation),
    definitionChanged: annotation.definitionDirty,
    rendered,
    screenPosition
  };
  annotation.layer.backend.update(annotation.resource, update);
}

function definitionForState(annotation: AnnotationState): BackendAnnotationDefinition {
  const common = {
    id: annotation.handle.id,
    type: annotation.handle.type,
    zIndex: annotation.zIndex,
    style: annotation.style,
    ...(annotation.ariaLabel !== undefined ? { ariaLabel: annotation.ariaLabel } : {}),
    ...(annotation.role !== undefined ? { role: annotation.role } : {})
  };
  return annotation.kind === "label"
    ? { ...common, type: "label", text: annotation.text }
    : { ...common, type: "marker", shape: annotation.shape, size: annotation.size };
}

function createDefinition(
  id: AnnotationId,
  type: "label" | "marker",
  options: LabelOptions | MarkerOptions,
  specific: { text: string } | { shape: MarkerShape; size: number }
): BackendAnnotationDefinition {
  return {
    id,
    type,
    zIndex: options.zIndex ?? 0,
    style: cloneStyle(options.style),
    ...specific,
    ...("ariaLabel" in options && options.ariaLabel !== undefined ? { ariaLabel: options.ariaLabel } : {}),
    ...("role" in options && options.role !== undefined ? { role: options.role } : {})
  };
}

function applyCommonPatch(state: AnnotationState, patch: LabelPatch | MarkerPatch): void {
  if (patch.anchor !== undefined) state.anchor = storeAnchor(patch.anchor);
  if (patch.visible !== undefined) state.visible = patch.visible;
  if (patch.zIndex !== undefined) state.zIndex = patch.zIndex;
  if (patch.worldOffset !== undefined) state.worldOffset = copyVec3(patch.worldOffset);
  if (patch.screenOffset !== undefined) state.screenOffset = copyVec2(patch.screenOffset);
  if ("minDistance" in patch) state.minDistance = patch.minDistance;
  if ("maxDistance" in patch) state.maxDistance = patch.maxDistance;
  validateDistances(state.minDistance, state.maxDistance);
  if (patch.hideWhenOffscreen !== undefined) state.hideWhenOffscreen = patch.hideWhenOffscreen;
  if (patch.clampToViewport !== undefined) state.clampToViewport = patch.clampToViewport;
  if (patch.style !== undefined) state.style = cloneStyle(patch.style);
  state.definitionDirty = true;
}

function requireLayer(layer: AnnotationLayer): LayerState {
  const state = layerStates.get(layer);
  if (!state) throw new AnnotatorError("Unknown annotation layer");
  assertLayerUsable(state);
  return state;
}

function assertLayerUsable(state: LayerState): void {
  if (state.disposed) throw new AnnotatorError("Annotation layer has been disposed");
}

function requireAnnotation(annotation: AnnotationHandle, kind: "label"): LabelState;
function requireAnnotation(annotation: AnnotationHandle, kind: "marker"): MarkerState;
function requireAnnotation(annotation: AnnotationHandle): AnnotationState;
function requireAnnotation(annotation: AnnotationHandle, kind?: AnnotationState["kind"]): AnnotationState {
  const state = annotationStates.get(annotation);
  if (!state) throw new AnnotatorError("Unknown annotation");
  if (state.disposed) throw new AnnotatorError("Annotation has been disposed");
  if (kind && state.kind !== kind) throw new AnnotatorError(`Expected a ${kind} annotation`);
  return state;
}

function nextId(layer: LayerState): AnnotationId {
  return layer.nextId++ as AnnotationId;
}

function evaluateText(source: string | (() => string)): string {
  return typeof source === "function" ? String(source()) : source;
}

function cloneStyle(style: AnnotationStyle | undefined): AnnotationStyle {
  return Object.freeze({ ...(style ?? {}) });
}

function validateDistances(minimum: number | undefined, maximum: number | undefined): void {
  if (minimum !== undefined && (!Number.isFinite(minimum) || minimum < 0)) {
    throw new AnnotatorError("Minimum distance must be a non-negative finite number");
  }
  if (maximum !== undefined && (!Number.isFinite(maximum) || maximum < 0)) {
    throw new AnnotatorError("Maximum distance must be a non-negative finite number");
  }
  if (minimum !== undefined && maximum !== undefined && minimum > maximum) {
    throw new AnnotatorError("Minimum distance cannot exceed maximum distance");
  }
}

function assertPositive(value: number, label: string): void {
  if (!Number.isFinite(value) || value <= 0) throw new AnnotatorError(`${label} must be a positive finite number`);
}

function clamp(value: number, minimum: number, maximum: number): number {
  if (maximum < minimum) return (minimum + maximum) * 0.5;
  return Math.min(maximum, Math.max(minimum, value));
}

function freezeVec3(value: ArrayLike<number>): readonly [number, number, number] {
  return Object.freeze([value[0] ?? 0, value[1] ?? 0, value[2] ?? 0]) as readonly [number, number, number];
}

function createSnapshot(
  handle: AnnotationHandle,
  rendered: boolean,
  hiddenReason: AnnotationHiddenReason,
  requestedVisible: boolean
): AnnotationSnapshot {
  return Object.freeze({
    id: handle.id,
    type: handle.type,
    requestedVisible,
    rendered,
    hiddenReason,
    worldPosition: null,
    screenPosition: null,
    unclampedScreenPosition: null,
    depth: null,
    bounds: null
  });
}

function createDomRect(x: number, y: number, width: number, height: number): Readonly<DOMRectReadOnly> {
  const rect = {
    x,
    y,
    width,
    height,
    top: y,
    right: x + width,
    bottom: y + height,
    left: x,
    toJSON: () => ({ x, y, width, height, top: y, right: x + width, bottom: y + height, left: x })
  };
  return Object.freeze(rect);
}
