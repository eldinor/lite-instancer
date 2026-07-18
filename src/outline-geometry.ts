import type { Mesh } from "@babylonjs/lite";
import { InstancerError } from "./errors.js";
import type { OutlineGeometry, OutlineRgb } from "./outline-types.js";

export interface PreparedOutlineGeometry extends OutlineGeometry {
  center: OutlineRgb;
}

export function prepareOutlineGeometry(
  geometry: OutlineGeometry,
  smoothNormals = true,
  epsilon = 1e-5
): PreparedOutlineGeometry {
  validateOutlineGeometry(geometry);
  if (!Number.isFinite(epsilon) || epsilon <= 0) {
    throw new InstancerError("smoothNormalEpsilon must be a positive finite number");
  }
  const positions = new Float32Array(geometry.positions);
  const normals = new Float32Array(geometry.normals);
  if (smoothNormals) {
    smoothOutlineNormals(positions, normals, epsilon);
  }
  return {
    positions,
    normals,
    indices: reverseTriangleWinding(geometry.indices),
    center: computeOutlineCenter(positions)
  };
}

export function validateOutlineGeometry(geometry: OutlineGeometry): void {
  if (!(geometry.positions instanceof Float32Array) || geometry.positions.length === 0 || geometry.positions.length % 3 !== 0) {
    throw new InstancerError("outline positions must be a non-empty Float32Array with XYZ triplets");
  }
  if (!(geometry.normals instanceof Float32Array) || geometry.normals.length !== geometry.positions.length) {
    throw new InstancerError("outline normals must be a Float32Array matching positions length");
  }
  if (!(geometry.indices instanceof Uint32Array) || geometry.indices.length === 0 || geometry.indices.length % 3 !== 0) {
    throw new InstancerError("outline indices must be a non-empty Uint32Array of triangles");
  }
  const vertexCount = geometry.positions.length / 3;
  for (const index of geometry.indices) {
    if (index >= vertexCount) {
      throw new InstancerError(`outline index ${index} exceeds vertex count ${vertexCount}`);
    }
  }
}

export function reverseTriangleWinding(indices: Uint32Array): Uint32Array {
  const result = new Uint32Array(indices.length);
  for (let i = 0; i < indices.length; i += 3) {
    result[i] = indices[i]!;
    result[i + 1] = indices[i + 2]!;
    result[i + 2] = indices[i + 1]!;
  }
  return result;
}

interface NormalGroup {
  x: number;
  y: number;
  z: number;
  indices: number[];
  sumX: number;
  sumY: number;
  sumZ: number;
}

export function smoothOutlineNormals(positions: Float32Array, normals: Float32Array, epsilon = 1e-5): void {
  const cells = new Map<string, NormalGroup[]>();
  const groups: NormalGroup[] = [];
  const inv = 1 / epsilon;
  const cellKey = (x: number, y: number, z: number) => `${x},${y},${z}`;

  for (let vertex = 0; vertex < positions.length / 3; vertex++) {
    const offset = vertex * 3;
    const x = positions[offset]!;
    const y = positions[offset + 1]!;
    const z = positions[offset + 2]!;
    const cx = Math.floor(x * inv);
    const cy = Math.floor(y * inv);
    const cz = Math.floor(z * inv);
    let group: NormalGroup | undefined;
    for (let dx = -1; dx <= 1 && !group; dx++) {
      for (let dy = -1; dy <= 1 && !group; dy++) {
        for (let dz = -1; dz <= 1 && !group; dz++) {
          const candidates = cells.get(cellKey(cx + dx, cy + dy, cz + dz));
          group = candidates?.find(
            (candidate) =>
              Math.abs(candidate.x - x) <= epsilon &&
              Math.abs(candidate.y - y) <= epsilon &&
              Math.abs(candidate.z - z) <= epsilon
          );
        }
      }
    }
    if (!group) {
      group = { x, y, z, indices: [], sumX: 0, sumY: 0, sumZ: 0 };
      const key = cellKey(cx, cy, cz);
      const bucket = cells.get(key);
      if (bucket) bucket.push(group);
      else cells.set(key, [group]);
      groups.push(group);
    }
    group.indices.push(vertex);
    group.sumX += normals[offset]!;
    group.sumY += normals[offset + 1]!;
    group.sumZ += normals[offset + 2]!;
  }

  for (const group of groups) {
    const length = Math.hypot(group.sumX, group.sumY, group.sumZ);
    if (length <= 1e-8) continue;
    const x = group.sumX / length;
    const y = group.sumY / length;
    const z = group.sumZ / length;
    for (const vertex of group.indices) {
      const offset = vertex * 3;
      normals[offset] = x;
      normals[offset + 1] = y;
      normals[offset + 2] = z;
    }
  }
}

export function computeOutlineCenter(positions: Float32Array): OutlineRgb {
  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  for (let i = 0; i < positions.length; i += 3) {
    const x = positions[i]!, y = positions[i + 1]!, z = positions[i + 2]!;
    minX = Math.min(minX, x); minY = Math.min(minY, y); minZ = Math.min(minZ, z);
    maxX = Math.max(maxX, x); maxY = Math.max(maxY, y); maxZ = Math.max(maxZ, z);
  }
  return [(minX + maxX) * 0.5, (minY + maxY) * 0.5, (minZ + maxZ) * 0.5];
}

export function computeOutlineAxisExtent(positions: Float32Array, axis: "x" | "y" | "z"): { min: number; invLength: number } {
  const component = axis === "x" ? 0 : axis === "y" ? 1 : 2;
  let min = Infinity;
  let max = -Infinity;
  for (let i = component; i < positions.length; i += 3) {
    min = Math.min(min, positions[i]!);
    max = Math.max(max, positions[i]!);
  }
  const length = max - min;
  return { min, invLength: length > 1e-6 ? 1 / length : 0 };
}

export function tryGetRetainedOutlineGeometry(mesh: Mesh): OutlineGeometry | null {
  const retained = mesh as Mesh & {
    _cpuPositions?: Float32Array;
    _cpuNormals?: Float32Array;
    _cpuIndices?: Uint32Array | Uint16Array;
  };
  if (!retained._cpuPositions || !retained._cpuNormals || !retained._cpuIndices) return null;
  return {
    positions: retained._cpuPositions,
    normals: retained._cpuNormals,
    indices: retained._cpuIndices instanceof Uint32Array ? retained._cpuIndices : new Uint32Array(retained._cpuIndices)
  };
}
