import type { Camera } from "@babylonjs/core/Cameras/camera.js";
import { Vector3 } from "@babylonjs/core/Maths/math.vector.js";
import type { Mesh } from "@babylonjs/core/Meshes/mesh.js";
import type { InstanceId, Mat4, Vec3Like } from "./types.js";
import { composeInstanceWorldMatrix } from "./world-matrix-adapter.js";

/** Minimal stable-ID mesh set accepted by rendered-center helpers. */
export interface MeshInstanceWorldCenterSource {
  readonly mesh: Mesh;
  getMatrix(id: InstanceId, out?: Mat4): Mat4;
}

export interface ScreenPointLike {
  readonly x: number;
  readonly y: number;
}

/** Width and height of the canvas or viewport used for projection. */
export interface ScreenViewportLike {
  readonly width: number;
  readonly height: number;
}

/** Canvas-like object accepted by pointer-based screen-space picking. */
export interface PointerViewportLike extends ScreenViewportLike {
  /** Return the viewport bounds in client coordinates. */
  getBoundingClientRect(): DOMRect;
}

/** Options for logical screen-space picking by projected instance centers. */
export interface ScreenSpaceInstancePickOptions {
  /** Candidate stable IDs to test. */
  ids: Iterable<InstanceId>;
  camera: Camera;
  viewport: ScreenViewportLike;
  point: ScreenPointLike;
  /** Return the current world-space logical center for an ID. */
  getWorldPosition(id: InstanceId, out?: Float32Array): Vec3Like | undefined;
  /** Return the pick radius in CSS pixels for an ID. Defaults to 24. */
  getScreenRadius?(id: InstanceId): number;
  /** Optional visibility predicate. */
  isVisible?(id: InstanceId): boolean;
  /** Optional existence predicate, useful when keeping an external ID array. */
  has?(id: InstanceId): boolean;
}

/** Pointer-event convenience options for screen-space picking. */
export interface PointerScreenSpaceInstancePickOptions
  extends Omit<ScreenSpaceInstancePickOptions, "point" | "viewport"> {
  event: Pick<PointerEvent, "clientX" | "clientY">;
  canvas: PointerViewportLike;
  /** Return the pick radius in CSS pixels for an ID. Defaults to 24. */
  getScreenRadius?(id: InstanceId): number;
  /** Optional visibility predicate. */
  isVisible?(id: InstanceId): boolean;
  /** Optional existence predicate, useful when keeping an external ID array. */
  has?(id: InstanceId): boolean;
}

/** Logical screen-space pick result. */
export interface ScreenSpaceInstancePick {
  id: InstanceId;
  distanceSquared: number;
  screen: ScreenPointLike;
  radius: number;
}

/**
 * Return the actual rendered world-space center for a logical mesh instance.
 * Authored mesh parents, imported root conversion, scale, and rotation are all
 * included using the same transform order as the Babylon adapter.
 */
export function getMeshInstanceWorldCenter(
  mesh: Mesh,
  logicalMatrix: Mat4,
  out: Float32Array = new Float32Array(3)
): Float32Array {
  const localCenter = mesh.rawBoundingInfo?.boundingBox.center ?? mesh.getBoundingInfo().boundingBox.center;
  const world = composeInstanceWorldMatrix(mesh, logicalMatrix);
  const center = Vector3.TransformCoordinates(localCenter, world);
  out[0] = center.x;
  out[1] = center.y;
  out[2] = center.z;
  return out;
}

/** Return the rendered center for a stable ID in a mesh-backed instance set. */
export function getInstanceSetWorldCenter(
  set: MeshInstanceWorldCenterSource,
  id: InstanceId,
  out?: Float32Array
): Float32Array {
  return getMeshInstanceWorldCenter(set.mesh, set.getMatrix(id), out);
}

/**
 * Pick the nearest candidate ID whose projected logical center is inside its screen radius.
 *
 * This is intended for animated/VAT/deformed instances where GPU picking may use rest geometry or a
 * mismatched proxy. It trades geometric exactness for stable app-level selection.
 */
export function pickScreenSpaceInstance(options: ScreenSpaceInstancePickOptions): ScreenSpaceInstancePick | undefined {
  const matrix = options.camera.getTransformationMatrix().m as unknown as Mat4;
  const positionScratch = new Float32Array(3);
  let nearestId: InstanceId | undefined;
  let nearestDistanceSquared = Number.POSITIVE_INFINITY;
  let nearestX = 0;
  let nearestY = 0;
  let nearestRadius = 0;

  for (const id of options.ids) {
    if (options.has && !options.has(id)) {
      continue;
    }
    if (options.isVisible && !options.isVisible(id)) {
      continue;
    }

    const position = options.getWorldPosition(id, positionScratch);
    if (!position) {
      continue;
    }

    const x = position[0];
    const y = position[1];
    const z = position[2];
    const clipX = matrixAt(matrix, 0) * x + matrixAt(matrix, 4) * y + matrixAt(matrix, 8) * z + matrixAt(matrix, 12);
    const clipY = matrixAt(matrix, 1) * x + matrixAt(matrix, 5) * y + matrixAt(matrix, 9) * z + matrixAt(matrix, 13);
    const clipW = matrixAt(matrix, 3) * x + matrixAt(matrix, 7) * y + matrixAt(matrix, 11) * z + matrixAt(matrix, 15);
    if (clipW <= 1e-6) continue;
    const ndcX = clipX / clipW;
    const ndcY = clipY / clipW;
    if (ndcX < -1.1 || ndcX > 1.1 || ndcY < -1.1 || ndcY > 1.1) continue;
    const screenX = ((ndcX + 1) * 0.5) * options.viewport.width;
    const screenY = ((1 - ndcY) * 0.5) * options.viewport.height;

    const radius = options.getScreenRadius?.(id) ?? 24;
    const dx = options.point.x - screenX;
    const dy = options.point.y - screenY;
    const distanceSquared = dx * dx + dy * dy;
    if (distanceSquared > radius * radius) {
      continue;
    }
    if (distanceSquared < nearestDistanceSquared) {
      nearestId = id;
      nearestDistanceSquared = distanceSquared;
      nearestX = screenX;
      nearestY = screenY;
      nearestRadius = radius;
    }
  }

  return nearestId === undefined ? undefined : {
    id: nearestId,
    distanceSquared: nearestDistanceSquared,
    screen: { x: nearestX, y: nearestY },
    radius: nearestRadius
  };
}

/** Convert a pointer event into canvas-local coordinates and run `pickScreenSpaceInstance`. */
export function pickScreenSpaceInstanceFromPointer(
  options: PointerScreenSpaceInstancePickOptions
): ScreenSpaceInstancePick | undefined {
  const rect = options.canvas.getBoundingClientRect();
  return pickScreenSpaceInstance({
    ...options,
    point: {
      x: options.event.clientX - rect.left,
      y: options.event.clientY - rect.top
    },
    viewport: {
      width: rect.width || options.canvas.width,
      height: rect.height || options.canvas.height
    }
  });
}

/** Project a world-space position to viewport pixel coordinates. */
export function projectWorldToScreen(
  position: Vec3Like,
  matrix: Mat4,
  viewport: ScreenViewportLike
): ScreenPointLike | undefined {
  const x = position[0];
  const y = position[1];
  const z = position[2];
  const clipX = matrixAt(matrix, 0) * x + matrixAt(matrix, 4) * y + matrixAt(matrix, 8) * z + matrixAt(matrix, 12);
  const clipY = matrixAt(matrix, 1) * x + matrixAt(matrix, 5) * y + matrixAt(matrix, 9) * z + matrixAt(matrix, 13);
  const clipW = matrixAt(matrix, 3) * x + matrixAt(matrix, 7) * y + matrixAt(matrix, 11) * z + matrixAt(matrix, 15);

  if (clipW <= 1e-6) {
    return undefined;
  }

  const ndcX = clipX / clipW;
  const ndcY = clipY / clipW;
  if (ndcX < -1.1 || ndcX > 1.1 || ndcY < -1.1 || ndcY > 1.1) {
    return undefined;
  }

  return {
    x: ((ndcX + 1) * 0.5) * viewport.width,
    y: ((1 - ndcY) * 0.5) * viewport.height
  };
}

function matrixAt(matrix: Mat4, index: number): number {
  return matrix[index] ?? 0;
}
