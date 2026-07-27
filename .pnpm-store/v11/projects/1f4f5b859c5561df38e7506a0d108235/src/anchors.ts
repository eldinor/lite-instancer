import type { Mat4 } from "@babylonjs/lite";
import type {
  AnchorPreset,
  AnchorResolution,
  MeshAnchor,
  ResolvableAnchor,
  SupportedAnnotationAnchor,
  Vec3Like,
  WorldAnchor
} from "./types.js";

export interface StoredWorldAnchor {
  readonly kind: "world";
  readonly position: Float64Array;
}

export type StoredMeshAnchor =
  | {
      readonly kind: "mesh-point";
      readonly mesh: MeshAnchor["mesh"];
      readonly point: Float64Array;
      readonly space: "local" | "world";
    }
  | {
      readonly kind: "mesh-preset";
      readonly mesh: MeshAnchor["mesh"];
      readonly preset: AnchorPreset;
    };

export type StoredAnchor = StoredWorldAnchor | StoredMeshAnchor | ResolvableAnchor;

export function storeAnchor(anchor: SupportedAnnotationAnchor): StoredAnchor {
  if (anchor.kind === "resolver") return anchor;
  if (anchor.kind === "world") {
    return { kind: "world", position: copyVec3(anchor.position) };
  }
  if ("point" in anchor) {
    return {
      kind: "mesh-point",
      mesh: anchor.mesh,
      point: copyVec3(anchor.point),
      space: anchor.space ?? "local"
    };
  }
  return {
    kind: "mesh-preset",
    mesh: anchor.mesh,
    preset: anchor.preset ?? "center"
  };
}

export function resolveAnchor(anchor: StoredAnchor, out: Float32Array): AnchorResolution {
  if (anchor.kind === "resolver") {
    const resolution = anchor.resolve(out);
    if (resolution.position && resolution.position !== out) copyInto(resolution.position, out);
    return resolution;
  }
  if (anchor.kind === "world") {
    copyInto(anchor.position, out);
    return { available: true, targetVisible: true, position: out };
  }
  if (anchor.kind === "mesh-point") {
    if (anchor.space === "world") {
      copyInto(anchor.point, out);
    } else {
      transformPoint(anchor.point, anchor.mesh.worldMatrix, out);
    }
    return { available: true, targetVisible: anchor.mesh.visible !== false, position: out };
  }

  const minimum = anchor.mesh.boundMin;
  const maximum = anchor.mesh.boundMax;
  if (minimum && maximum) {
    presetPoint(minimum, maximum, anchor.preset, out);
  } else {
    transformPoint(ORIGIN, anchor.mesh.worldMatrix, out);
  }
  return { available: true, targetVisible: anchor.mesh.visible !== false, position: out };
}

export function copyVec2(value: ArrayLike<number> | undefined): Float64Array {
  return new Float64Array([value?.[0] ?? 0, value?.[1] ?? 0]);
}

export function copyVec3(value: Vec3Like | undefined): Float64Array {
  return new Float64Array([value?.[0] ?? 0, value?.[1] ?? 0, value?.[2] ?? 0]);
}

export function transformPoint(point: ArrayLike<number>, matrix: Mat4, out: Float32Array): Float32Array {
  const x = point[0] ?? 0;
  const y = point[1] ?? 0;
  const z = point[2] ?? 0;
  out[0] = (matrix[0] ?? 0) * x + (matrix[4] ?? 0) * y + (matrix[8] ?? 0) * z + (matrix[12] ?? 0);
  out[1] = (matrix[1] ?? 0) * x + (matrix[5] ?? 0) * y + (matrix[9] ?? 0) * z + (matrix[13] ?? 0);
  out[2] = (matrix[2] ?? 0) * x + (matrix[6] ?? 0) * y + (matrix[10] ?? 0) * z + (matrix[14] ?? 0);
  return out;
}

export function presetPoint(
  minimum: ArrayLike<number>,
  maximum: ArrayLike<number>,
  preset: AnchorPreset,
  out: Float32Array
): Float32Array {
  const minX = minimum[0] ?? 0;
  const minY = minimum[1] ?? 0;
  const minZ = minimum[2] ?? 0;
  const maxX = maximum[0] ?? 0;
  const maxY = maximum[1] ?? 0;
  const maxZ = maximum[2] ?? 0;
  out[0] = (minX + maxX) * 0.5;
  out[1] = (minY + maxY) * 0.5;
  out[2] = (minZ + maxZ) * 0.5;
  if (preset === "left") out[0] = minX;
  if (preset === "right") out[0] = maxX;
  if (preset === "bottom") out[1] = minY;
  if (preset === "top") out[1] = maxY;
  if (preset === "back") out[2] = minZ;
  if (preset === "front") out[2] = maxZ;
  return out;
}

function copyInto(value: ArrayLike<number>, out: Float32Array): void {
  out[0] = value[0] ?? 0;
  out[1] = value[1] ?? 0;
  out[2] = value[2] ?? 0;
}

const ORIGIN = new Float64Array(3);
