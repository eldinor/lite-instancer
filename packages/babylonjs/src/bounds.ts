import { Vector3 } from "@babylonjs/core/Maths/math.vector.js";
import type { Mesh } from "@babylonjs/core/Meshes/mesh.js";
import { InstancerError } from "./errors.js";
import type { InstanceBounds, InstanceBoundsMode, Vec3Like } from "./types.js";

export interface MeshBoundsOwnership {
  readonly previousDoNotSyncBoundingInfo: boolean;
  readonly originalBounds?: InstanceBounds;
}

export function prepareBoundsOwnership(
  mesh: Mesh,
  mode: InstanceBoundsMode,
  fixedBounds: InstanceBounds | undefined
): MeshBoundsOwnership {
  if (mode === "fixed" && !fixedBounds) {
    throw new InstancerError("fixedBounds is required when boundsMode is 'fixed'");
  }
  if (fixedBounds) validateBounds(fixedBounds);
  const current = mesh.getBoundingInfo();
  const originalBounds = {
    minimum: [current.minimum.x, current.minimum.y, current.minimum.z] as const,
    maximum: [current.maximum.x, current.maximum.y, current.maximum.z] as const
  } satisfies InstanceBounds;
  const ownership: MeshBoundsOwnership = {
    previousDoNotSyncBoundingInfo: mesh.doNotSyncBoundingInfo,
    ...(isValidBounds(originalBounds) ? { originalBounds } : {})
  };
  // The instancer owns aggregate refresh scheduling while its thin-instance buffers are attached.
  // This prevents Babylon.js from performing an implicit scan in addition to our coalesced refresh.
  mesh.doNotSyncBoundingInfo = true;
  return ownership;
}

export function refreshMeshBounds(
  mesh: Mesh,
  mode: InstanceBoundsMode,
  fixedBounds: InstanceBounds | undefined
): void {
  if (mode === "fixed") {
    applyBounds(mesh, fixedBounds!);
  } else if (mesh.thinInstanceCount > 0) {
    mesh.thinInstanceRefreshBoundingInfo(false);
  }
}

export function restoreBoundsOwnership(mesh: Mesh, ownership: MeshBoundsOwnership): void {
  mesh.doNotSyncBoundingInfo = ownership.previousDoNotSyncBoundingInfo;
  if (ownership.originalBounds) {
    mesh.rawBoundingInfo = null;
    applyBounds(mesh, ownership.originalBounds);
  }
}

export function applyBounds(mesh: Mesh, bounds: InstanceBounds): void {
  validateBounds(bounds);
  const world = mesh.computeWorldMatrix(true);
  mesh.getBoundingInfo().reConstruct(toVector3(bounds.minimum), toVector3(bounds.maximum), world);
}

function validateBounds(bounds: InstanceBounds): void {
  if (isValidBounds(bounds)) return;
  throw new InstancerError("Instance bounds must contain finite minimum values not greater than maximum values");
}

function isValidBounds(bounds: InstanceBounds): boolean {
  for (let axis = 0; axis < 3; axis++) {
    const minimum = bounds.minimum[axis] ?? Number.NaN;
    const maximum = bounds.maximum[axis] ?? Number.NaN;
    if (!Number.isFinite(minimum) || !Number.isFinite(maximum) || minimum > maximum) {
      return false;
    }
  }
  return true;
}

function toVector3(value: Vec3Like): Vector3 {
  return new Vector3(value[0], value[1], value[2]);
}
