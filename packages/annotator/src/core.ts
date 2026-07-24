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
  AnnotationOcclusionMode,
  AnnotationOcclusionRequest,
  AnnotationSnapshot,
  AnnotationStyle,
  BackendAnnotationDefinition,
  BackendAnnotationUpdate,
  BackendLeaderLineGeometry,
  LabelHandle,
  LabelCollisionMode,
  LabelOptions,
  LabelPatch,
  LeaderLineOptions,
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
  occlusionMode: AnnotationOcclusionMode;
  occludedOpacity: number | undefined;
  occluded: boolean;
  occlusionBias: number;
  occlusionRevision: number;
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
  collision: LabelCollisionMode;
  collisionPadding: number;
  collisionMaxShift: number;
  clusterCount: number;
  previousClusterCount: number;
  clusterNeedsRefresh: boolean;
  leaderLine: Readonly<LeaderLineOptions> | undefined;
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
  readonly collisionCandidates: LabelState[];
  readonly occlusionRequests: AnnotationOcclusionRequest[];
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
    cameraPositionScratch: new Float64Array(3),
    collisionCandidates: [],
    occlusionRequests: []
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
  assertCollisionMode(options.collision);
  assertNonNegative(options.collisionPadding ?? 0, "Label collision padding");
  assertNonNegative(options.collisionMaxShift ?? 96, "Label maximum collision shift");
  const leaderLine = normalizeLeaderLine(options.leaderLine);
  const id = nextId(layerState);
  const handle = Object.freeze({ id, type: "label" as const }) as LabelHandle;
  const text = evaluateText(options.text);
  const definition = createDefinition(id, "label", options, {
    text,
    ...(leaderLine ? { leaderLine } : {})
  });
  const state = createCommonState(layerState, handle, options, definition) as LabelState;
  state.kind = "label";
  state.textSource = options.text;
  state.text = text;
  state.collision = options.collision ?? "none";
  state.collisionPadding = options.collisionPadding ?? 0;
  state.collisionMaxShift = options.collisionMaxShift ?? 96;
  state.clusterCount = 1;
  state.previousClusterCount = 1;
  state.clusterNeedsRefresh = false;
  state.leaderLine = leaderLine;
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
  if (patch.collision !== undefined) {
    assertCollisionMode(patch.collision);
    state.collision = patch.collision;
  }
  if (patch.collisionPadding !== undefined) {
    assertNonNegative(patch.collisionPadding, "Label collision padding");
    state.collisionPadding = patch.collisionPadding;
  }
  if (patch.collisionMaxShift !== undefined) {
    assertNonNegative(patch.collisionMaxShift, "Label maximum collision shift");
    state.collisionMaxShift = patch.collisionMaxShift;
  }
  if ("leaderLine" in patch) {
    state.leaderLine = normalizeLeaderLine(patch.leaderLine);
    state.definitionDirty = true;
  }
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
  const state = requireAnnotation(annotation);
  state.anchor = storeAnchor(anchor);
  state.occlusionRevision++;
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
  state.options.occlusionProvider?.dispose();
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
  assertNonNegative(options.occlusionBias ?? 0.0001, "Occlusion bias");
  assertOpacity(options.occludedOpacity, "Occluded opacity");
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
    occlusionMode: resolveInitialOcclusionMode(options),
    occludedOpacity: options.occludedOpacity,
    occluded: false,
    occlusionBias: options.occlusionBias ?? 0.0001,
    occlusionRevision: 0,
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
    layer.options.occlusionProvider?.update([]);
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
  const occlusionRequests = layer.occlusionRequests;
  occlusionRequests.length = 0;

  for (const annotation of layer.annotations.values()) {
    if (annotation.kind === "label") {
      annotation.previousClusterCount = annotation.clusterCount;
      annotation.clusterCount = 1;
      annotation.clusterNeedsRefresh = annotation.definitionDirty;
    }
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
    if (annotation.occlusionMode !== "none" && !projection.offscreen && layer.options.occlusionProvider) {
      occlusionRequests.push({
        id: annotation.handle.id,
        screenPosition: projection.screenPosition,
        depth: projection.depth,
        bias: annotation.occlusionBias,
        revision: annotation.occlusionRevision
      });
      const occluded =
        layer.options.occlusionProvider.getResult(
          annotation.handle.id,
          annotation.occlusionRevision
        ) === "occluded";
      setOccluded(annotation, occluded);
      if (occluded && annotation.occlusionMode === "hide") {
        hideAnnotation(annotation, "occluded", projection.depth, annotation.worldScratch, true);
        continue;
      }
    } else {
      setOccluded(annotation, false);
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
      occluded: annotation.occluded,
      hiddenReason: "none",
      worldPosition: freezeVec3(annotation.worldScratch),
      screenPosition: Object.freeze(final),
      unclampedScreenPosition: Object.freeze(raw),
      layoutOffset: Object.freeze({ x: 0, y: 0 }),
      depth: projection.depth,
      bounds: measured ? createDomRect(measured.x, measured.y, measured.width, measured.height) : null
    });
    annotation.definitionDirty = false;
  }
  layer.options.occlusionProvider?.update(occlusionRequests);
  applyLabelCollisions(layer, cameraViewport, padding);
}

function applyLabelCollisions(
  layer: LayerState,
  viewport: Readonly<{ left: number; top: number; width: number; height: number }>,
  viewportPadding: number
): void {
  const candidates = layer.collisionCandidates;
  candidates.length = 0;
  const occupied = new CollisionGrid();
  const clusterMembers = new CollisionGrid();
  const clusterGroups = new Map<CollisionRect, ClusterGroup>();
  const clusters: ClusterGroup[] = [];

  for (const annotation of layer.annotations.values()) {
    if (annotation.kind !== "label" || !annotation.snapshot.rendered || !annotation.snapshot.bounds) continue;
    if (annotation.collision !== "none") candidates.push(annotation);
    else occupied.insert(rectForBounds(annotation.snapshot.bounds, 0));
  }

  candidates.sort((left, right) => right.zIndex - left.zIndex || left.handle.id - right.handle.id);
  for (const annotation of candidates) {
    const bounds = annotation.snapshot.bounds;
    if (!bounds) continue;
    const rect = rectForBounds(bounds, annotation.collisionPadding);
    if (annotation.collision === "cluster") {
      const overlappingMember = clusterMembers.findOverlap(rect);
      if (overlappingMember) {
        const group = clusterGroups.get(overlappingMember);
        if (group) {
          group.count++;
          clusterMembers.insert(rect);
          clusterGroups.set(rect, group);
          const snapshot = annotation.snapshot;
          hideAnnotation(annotation, "collision", snapshot.depth, snapshot.worldPosition ?? undefined);
          continue;
        }
      }
      if (occupied.overlaps(rect)) {
        const snapshot = annotation.snapshot;
        hideAnnotation(annotation, "collision", snapshot.depth, snapshot.worldPosition ?? undefined);
        continue;
      }
      const group: ClusterGroup = { representative: annotation, count: 1 };
      clusters.push(group);
      clusterMembers.insert(rect);
      clusterGroups.set(rect, group);
      occupied.insert(rect);
      continue;
    }
    if (occupied.overlaps(rect)) {
      if (
        annotation.collision === "shift" ||
        annotation.collision === "shift-x" ||
        annotation.collision === "shift-y" ||
        annotation.collision === "radial" ||
        annotation.collision === "repel"
      ) {
        const placement =
          annotation.collision === "repel"
            ? findRepelPlacement(
                bounds,
                annotation.collisionPadding,
                annotation.collisionMaxShift,
                occupied,
                viewport,
                viewportPadding,
                annotation.handle.id
              )
            : findShiftPlacement(
                bounds,
                annotation.collisionPadding,
                annotation.collisionMaxShift,
                occupied,
                viewport,
                viewportPadding,
                annotation.collision,
                annotation.handle.id
              );
        if (placement) {
          shiftAnnotation(annotation, placement);
          occupied.insert(placement.collisionRect);
          continue;
        }
      }
      const snapshot = annotation.snapshot;
      hideAnnotation(annotation, "collision", snapshot.depth, snapshot.worldPosition ?? undefined);
      continue;
    }
    occupied.insert(rect);
  }
  for (const group of clusters) {
    if (group.count > 1) updateClusterRepresentative(group);
  }
  for (const annotation of layer.annotations.values()) {
    if (
      annotation.kind === "label" &&
      annotation.previousClusterCount > 1 &&
      annotation.clusterCount === 1
    ) {
      restoreClusterRepresentative(annotation);
    }
  }
}

interface ClusterGroup {
  readonly representative: LabelState;
  count: number;
}

function updateClusterRepresentative(
  group: ClusterGroup
): void {
  const annotation = group.representative;
  const snapshot = annotation.snapshot;
  if (!snapshot.screenPosition) return;
  annotation.clusterCount = group.count;
  if (
    annotation.previousClusterCount === group.count &&
    !annotation.clusterNeedsRefresh
  ) {
    return;
  }
  const summary = `${group.count} labels`;
  annotation.layer.backend.update(annotation.resource, {
    ...definitionForState(annotation),
    text: summary,
    ariaLabel: summary,
    definitionChanged: true,
    rendered: true,
    screenPosition: snapshot.screenPosition,
    leaderLineGeometry: null
  });
  const measured = annotation.layer.backend.measure(annotation.resource);
  if (!measured) return;
  const bounds = createDomRect(measured.x, measured.y, measured.width, measured.height);
  annotation.snapshot = Object.freeze({ ...snapshot, bounds });
}

function restoreClusterRepresentative(annotation: LabelState): void {
  const snapshot = annotation.snapshot;
  updateBackend(
    annotation,
    snapshot.rendered,
    snapshot.screenPosition,
    null,
    true
  );
  if (!snapshot.rendered || !snapshot.screenPosition) return;
  const measured = annotation.layer.backend.measure(annotation.resource);
  if (!measured) return;
  annotation.snapshot = Object.freeze({
    ...snapshot,
    bounds: createDomRect(measured.x, measured.y, measured.width, measured.height)
  });
}

interface ShiftPlacement {
  readonly x: number;
  readonly y: number;
  readonly bounds: Readonly<DOMRectReadOnly>;
  readonly collisionRect: CollisionRect;
}

function findShiftPlacement(
  bounds: Readonly<DOMRectReadOnly>,
  collisionPadding: number,
  maximumShift: number,
  occupied: CollisionGrid,
  viewport: Readonly<{ left: number; top: number; width: number; height: number }>,
  viewportPadding: number,
  mode: "shift" | "shift-x" | "shift-y" | "radial",
  seed: number
): ShiftPlacement | null {
  const step = 12;
  const directions = collisionDirections(mode, bounds, viewport, seed);
  for (
    let radius = Math.min(step, maximumShift);
    radius > 0;
    radius = Math.min(radius + step, maximumShift)
  ) {
    for (const direction of directions) {
      const x = direction[0] * radius;
      const y = direction[1] * radius;
      const shifted = createDomRect(bounds.x + x, bounds.y + y, bounds.width, bounds.height);
      if (!boundsInsideViewport(shifted, viewport, viewportPadding)) continue;
      const collisionRect = rectForBounds(shifted, collisionPadding);
      if (!occupied.overlaps(collisionRect)) return { x, y, bounds: shifted, collisionRect };
    }
    if (radius === maximumShift) break;
  }
  return null;
}

function findRepelPlacement(
  bounds: Readonly<DOMRectReadOnly>,
  collisionPadding: number,
  maximumShift: number,
  occupied: CollisionGrid,
  viewport: Readonly<{ left: number; top: number; width: number; height: number }>,
  viewportPadding: number,
  seed: number
): ShiftPlacement | null {
  if (maximumShift <= 0) return null;
  const step = 8;
  const maximumIterations = Math.ceil(maximumShift / step) * 2 + 4;
  const minimumX = viewport.left + viewportPadding - bounds.left;
  const maximumX = viewport.left + viewport.width - viewportPadding - bounds.right;
  const minimumY = viewport.top + viewportPadding - bounds.top;
  const maximumY = viewport.top + viewport.height - viewportPadding - bounds.bottom;
  if (minimumX > maximumX || minimumY > maximumY) return null;
  let x = 0;
  let y = 0;

  for (let iteration = 0; iteration < maximumIterations; iteration++) {
    const shifted = createDomRect(bounds.x + x, bounds.y + y, bounds.width, bounds.height);
    const collisionRect = rectForBounds(shifted, collisionPadding);
    const blocker = occupied.findOverlap(collisionRect);
    if (!blocker && boundsInsideViewport(shifted, viewport, viewportPadding)) {
      return { x, y, bounds: shifted, collisionRect };
    }
    if (!blocker) return null;

    const centerX = (collisionRect.left + collisionRect.right) * 0.5;
    const centerY = (collisionRect.top + collisionRect.bottom) * 0.5;
    let directionX = centerX - (blocker.left + blocker.right) * 0.5;
    let directionY = centerY - (blocker.top + blocker.bottom) * 0.5;
    let length = Math.hypot(directionX, directionY);
    if (length < 0.0001) {
      const angle = seed * GOLDEN_ANGLE;
      directionX = Math.cos(angle);
      directionY = Math.sin(angle);
      length = 1;
    }
    directionX /= length;
    directionY /= length;

    let nextX = clamp(x + directionX * step, minimumX, maximumX);
    let nextY = clamp(y + directionY * step, minimumY, maximumY);
    if (Math.abs(nextX - x) + Math.abs(nextY - y) < 0.0001) {
      const turn = (seed + iteration) % 2 === 0 ? 1 : -1;
      nextX = clamp(x - directionY * step * turn, minimumX, maximumX);
      nextY = clamp(y + directionX * step * turn, minimumY, maximumY);
    }
    const displacement = Math.hypot(nextX, nextY);
    if (displacement > maximumShift) {
      const scale = maximumShift / displacement;
      nextX *= scale;
      nextY *= scale;
    }
    if (Math.abs(nextX - x) + Math.abs(nextY - y) < 0.0001) break;
    x = nextX;
    y = nextY;
  }
  return null;
}

function shiftAnnotation(annotation: LabelState, placement: ShiftPlacement): void {
  const snapshot = annotation.snapshot;
  const base = snapshot.screenPosition;
  if (!base) return;
  const screenPosition = Object.freeze({
    x: base.x + placement.x,
    y: base.y + placement.y
  });
  const leaderLineGeometry = createLeaderLineGeometry(annotation, base, placement);
  updateBackend(annotation, true, screenPosition, leaderLineGeometry);
  annotation.snapshot = Object.freeze({
    ...snapshot,
    screenPosition,
    layoutOffset: Object.freeze({ x: placement.x, y: placement.y }),
    bounds: placement.bounds
  });
}

function createLeaderLineGeometry(
  annotation: LabelState,
  start: Readonly<{ x: number; y: number }>,
  placement: ShiftPlacement
): Readonly<BackendLeaderLineGeometry> | null {
  const options = annotation.leaderLine;
  if (!options || Math.hypot(placement.x, placement.y) < (options.minLength ?? 8)) return null;
  const bounds = placement.bounds;
  if (
    start.x >= bounds.left &&
    start.x <= bounds.right &&
    start.y >= bounds.top &&
    start.y <= bounds.bottom
  ) {
    return null;
  }
  const centerX = bounds.left + bounds.width * 0.5;
  const centerY = bounds.top + bounds.height * 0.5;
  const deltaX = start.x - centerX;
  const deltaY = start.y - centerY;
  const scaleX = deltaX === 0 ? Number.POSITIVE_INFINITY : (bounds.width * 0.5) / Math.abs(deltaX);
  const scaleY = deltaY === 0 ? Number.POSITIVE_INFINITY : (bounds.height * 0.5) / Math.abs(deltaY);
  const scale = Math.min(scaleX, scaleY);
  return Object.freeze({
    start: Object.freeze({ x: start.x, y: start.y }),
    end: Object.freeze({
      x: centerX + deltaX * scale,
      y: centerY + deltaY * scale
    })
  });
}

function hideAnnotation(
  annotation: AnnotationState,
  reason: AnnotationHiddenReason,
  depth: number | null = null,
  world?: ArrayLike<number>,
  occluded = false
): void {
  setOccluded(annotation, occluded);
  updateBackend(annotation, false, null);
  annotation.snapshot = Object.freeze({
    id: annotation.handle.id,
    type: annotation.handle.type,
    requestedVisible: annotation.visible,
    rendered: false,
    occluded: annotation.occluded,
    hiddenReason: reason,
    worldPosition: world ? freezeVec3(world) : null,
    screenPosition: null,
    unclampedScreenPosition: null,
    layoutOffset: null,
    depth,
    bounds: null
  });
  annotation.definitionDirty = false;
}

function updateBackend(
  annotation: AnnotationState,
  rendered: boolean,
  screenPosition: Readonly<{ x: number; y: number }> | null,
  leaderLineGeometry: Readonly<BackendLeaderLineGeometry> | null = null,
  forceDefinitionChanged = false
): void {
  const update: BackendAnnotationUpdate = {
    ...definitionForState(annotation),
    definitionChanged: forceDefinitionChanged || annotation.definitionDirty,
    rendered,
    screenPosition,
    leaderLineGeometry
  };
  annotation.layer.backend.update(annotation.resource, update);
}

function definitionForState(annotation: AnnotationState): BackendAnnotationDefinition {
  const style =
    annotation.occluded && annotation.occlusionMode === "fade"
      ? {
          ...annotation.style,
          opacity: (annotation.style.opacity ?? 1) * (annotation.occludedOpacity ?? 0.5)
        }
      : annotation.style;
  const common = {
    id: annotation.handle.id,
    type: annotation.handle.type,
    zIndex: annotation.zIndex,
    style,
    ...(annotation.ariaLabel !== undefined ? { ariaLabel: annotation.ariaLabel } : {}),
    ...(annotation.role !== undefined ? { role: annotation.role } : {})
  };
  return annotation.kind === "label"
    ? {
        ...common,
        type: "label",
        text: annotation.text,
        ...(annotation.leaderLine ? { leaderLine: annotation.leaderLine } : {})
      }
    : { ...common, type: "marker", shape: annotation.shape, size: annotation.size };
}

function createDefinition(
  id: AnnotationId,
  type: "label" | "marker",
  options: LabelOptions | MarkerOptions,
  specific:
    | { text: string; leaderLine?: Readonly<LeaderLineOptions> }
    | { shape: MarkerShape; size: number }
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
  if (patch.anchor !== undefined) {
    state.anchor = storeAnchor(patch.anchor);
    state.occlusionRevision++;
  }
  if (patch.visible !== undefined) state.visible = patch.visible;
  if (patch.zIndex !== undefined) state.zIndex = patch.zIndex;
  if (patch.worldOffset !== undefined) {
    state.worldOffset = copyVec3(patch.worldOffset);
    state.occlusionRevision++;
  }
  if (patch.screenOffset !== undefined) state.screenOffset = copyVec2(patch.screenOffset);
  if ("minDistance" in patch) state.minDistance = patch.minDistance;
  if ("maxDistance" in patch) state.maxDistance = patch.maxDistance;
  validateDistances(state.minDistance, state.maxDistance);
  if (patch.hideWhenOffscreen !== undefined) state.hideWhenOffscreen = patch.hideWhenOffscreen;
  if (patch.clampToViewport !== undefined) state.clampToViewport = patch.clampToViewport;
  if (patch.occlusion !== undefined) {
    assertOcclusionMode(patch.occlusion);
    state.occlusionMode = patch.occlusion;
  } else if (patch.hideWhenOccluded !== undefined) {
    state.occlusionMode = patch.hideWhenOccluded
      ? patch.occludedOpacity !== undefined || state.occludedOpacity !== undefined
        ? "fade"
        : "hide"
      : "none";
  }
  if ("occludedOpacity" in patch) {
    assertOpacity(patch.occludedOpacity, "Occluded opacity");
    state.occludedOpacity = patch.occludedOpacity;
    if (patch.occlusion === undefined && patch.hideWhenOccluded === undefined && state.occlusionMode === "hide") {
      state.occlusionMode = "fade";
    }
  }
  if (patch.occlusionBias !== undefined) {
    assertNonNegative(patch.occlusionBias, "Occlusion bias");
    state.occlusionBias = patch.occlusionBias;
    state.occlusionRevision++;
  }
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
  if (style?.opacityTransitionDuration !== undefined) {
    assertNonNegative(style.opacityTransitionDuration, "Opacity transition duration");
  }
  return Object.freeze({ ...(style ?? {}) });
}

function normalizeLeaderLine(
  value: boolean | LeaderLineOptions | undefined
): Readonly<LeaderLineOptions> | undefined {
  if (!value) return undefined;
  const source = value === true ? {} : value;
  const width = source.width ?? 1;
  const opacity = source.opacity ?? 1;
  const minLength = source.minLength ?? 8;
  assertPositive(width, "Leader line width");
  assertNonNegative(minLength, "Leader line minimum length");
  if (!Number.isFinite(opacity) || opacity < 0 || opacity > 1) {
    throw new AnnotatorError("Leader line opacity must be a finite number from 0 to 1");
  }
  return Object.freeze({
    ...(source.color !== undefined ? { color: source.color } : {}),
    width,
    opacity,
    minLength
  });
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

function assertNonNegative(value: number, label: string): void {
  if (!Number.isFinite(value) || value < 0) {
    throw new AnnotatorError(`${label} must be a non-negative finite number`);
  }
}

function assertOpacity(value: number | undefined, label: string): void {
  if (value !== undefined && (!Number.isFinite(value) || value < 0 || value > 1)) {
    throw new AnnotatorError(`${label} must be a finite number from 0 to 1`);
  }
}

function setOccluded(annotation: AnnotationState, occluded: boolean): void {
  if (annotation.occluded === occluded) return;
  annotation.occluded = occluded;
  annotation.definitionDirty = true;
}

function assertCollisionMode(value: LabelCollisionMode | undefined): void {
  if (
    value !== undefined &&
    value !== "none" &&
    value !== "hide" &&
    value !== "shift" &&
    value !== "shift-x" &&
    value !== "shift-y" &&
    value !== "radial" &&
    value !== "cluster" &&
    value !== "repel"
  ) {
    throw new AnnotatorError(
      "Label collision mode must be 'none', 'hide', 'shift', 'shift-x', 'shift-y', 'radial', 'cluster', or 'repel'"
    );
  }
}

function assertOcclusionMode(value: AnnotationOcclusionMode): void {
  if (value !== "none" && value !== "hide" && value !== "fade") {
    throw new AnnotatorError("Annotation occlusion mode must be 'none', 'hide', or 'fade'");
  }
}

function resolveInitialOcclusionMode(
  options: LabelOptions | MarkerOptions
): AnnotationOcclusionMode {
  if (options.occlusion !== undefined) {
    assertOcclusionMode(options.occlusion);
    return options.occlusion;
  }
  if (!options.hideWhenOccluded) return "none";
  return options.occludedOpacity === undefined ? "hide" : "fade";
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
    occluded: hiddenReason === "occluded",
    hiddenReason,
    worldPosition: null,
    screenPosition: null,
    unclampedScreenPosition: null,
    layoutOffset: null,
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

interface CollisionRect {
  readonly left: number;
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
}

const DIAGONAL = Math.SQRT1_2;
const SHIFT_DIRECTIONS: ReadonlyArray<readonly [number, number]> = [
  [0, -1],
  [DIAGONAL, -DIAGONAL],
  [1, 0],
  [DIAGONAL, DIAGONAL],
  [0, 1],
  [-DIAGONAL, DIAGONAL],
  [-1, 0],
  [-DIAGONAL, -DIAGONAL]
];
const SHIFT_Y_DIRECTIONS: ReadonlyArray<readonly [number, number]> = [
  [0, -1],
  [0, 1]
];
const SHIFT_X_DIRECTIONS: ReadonlyArray<readonly [number, number]> = [
  [1, 0],
  [-1, 0]
];
const RADIAL_ANGLE_OFFSETS = [
  0,
  -Math.PI / 4,
  Math.PI / 4,
  -Math.PI / 2,
  Math.PI / 2,
  Math.PI,
  -3 * Math.PI / 4,
  3 * Math.PI / 4
] as const;
const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));

function collisionDirections(
  mode: "shift" | "shift-x" | "shift-y" | "radial",
  bounds: Readonly<DOMRectReadOnly>,
  viewport: Readonly<{ left: number; top: number; width: number; height: number }>,
  seed: number
): ReadonlyArray<readonly [number, number]> {
  if (mode === "shift") return SHIFT_DIRECTIONS;
  if (mode === "shift-x") return SHIFT_X_DIRECTIONS;
  if (mode === "shift-y") return SHIFT_Y_DIRECTIONS;
  const deltaX = bounds.left + bounds.width * 0.5 - (viewport.left + viewport.width * 0.5);
  const deltaY = bounds.top + bounds.height * 0.5 - (viewport.top + viewport.height * 0.5);
  const baseAngle =
    Math.abs(deltaX) + Math.abs(deltaY) > 0.0001
      ? Math.atan2(deltaY, deltaX)
      : seed * GOLDEN_ANGLE;
  return RADIAL_ANGLE_OFFSETS.map((offset) => {
    const angle = baseAngle + offset;
    return [Math.cos(angle), Math.sin(angle)] as const;
  });
}

function boundsInsideViewport(
  bounds: Readonly<DOMRectReadOnly>,
  viewport: Readonly<{ left: number; top: number; width: number; height: number }>,
  padding: number
): boolean {
  return (
    bounds.left >= viewport.left + padding &&
    bounds.right <= viewport.left + viewport.width - padding &&
    bounds.top >= viewport.top + padding &&
    bounds.bottom <= viewport.top + viewport.height - padding
  );
}

function rectForBounds(bounds: Readonly<DOMRectReadOnly>, padding: number): CollisionRect {
  return {
    left: bounds.left - padding,
    top: bounds.top - padding,
    right: bounds.right + padding,
    bottom: bounds.bottom + padding
  };
}

class CollisionGrid {
  readonly #cells = new Map<string, CollisionRect[]>();
  readonly #cellSize = 64;

  insert(rect: CollisionRect): void {
    this.#forEachCell(rect, (key) => {
      const cell = this.#cells.get(key);
      if (cell) cell.push(rect);
      else this.#cells.set(key, [rect]);
      return false;
    });
  }

  overlaps(rect: CollisionRect): boolean {
    return this.findOverlap(rect) !== null;
  }

  findOverlap(rect: CollisionRect): CollisionRect | null {
    let overlap: CollisionRect | null = null;
    this.#forEachCell(rect, (key) => {
      const cell = this.#cells.get(key);
      if (!cell) return false;
      for (const occupied of cell) {
        if (
          rect.left < occupied.right &&
          rect.right > occupied.left &&
          rect.top < occupied.bottom &&
          rect.bottom > occupied.top
        ) {
          overlap = occupied;
          return true;
        }
      }
      return false;
    });
    return overlap;
  }

  #forEachCell(rect: CollisionRect, callback: (key: string) => boolean): void {
    const minimumX = Math.floor(rect.left / this.#cellSize);
    const maximumX = Math.floor(rect.right / this.#cellSize);
    const minimumY = Math.floor(rect.top / this.#cellSize);
    const maximumY = Math.floor(rect.bottom / this.#cellSize);
    for (let y = minimumY; y <= maximumY; y++) {
      for (let x = minimumX; x <= maximumX; x++) {
        if (callback(`${x}:${y}`)) return;
      }
    }
  }
}
