import type { Mesh } from "@babylonjs/lite";
import { InstancerError } from "./errors.js";
import type { OutlineGeometry, OutlineRgb } from "./outline-types.js";

export interface PreparedOutlineGeometry extends OutlineGeometry {
  center: OutlineRgb;
}

/**
 * Validate and copy source geometry into the form used by the outline renderer.
 * Triangle winding is reversed for the expanded back-face pass, and coincident
 * vertex normals can be averaged to avoid seams along authored hard edges.
 *
 * @param geometry - CPU-side positions, normals, and triangle indices.
 * @param smoothNormals - Whether to average normals at coincident positions.
 * @param epsilon - Maximum positional difference used to group coincident vertices.
 * @returns Independent geometry buffers plus the local-space bounds center.
 * @throws `InstancerError` when the geometry or smoothing epsilon is invalid.
 */
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

/**
 * Validate the shape and index range of CPU-side outline geometry.
 *
 * @param geometry - Geometry to validate.
 * @throws `InstancerError` when buffers have invalid types or lengths, or an index is out of range.
 */
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

/**
 * Reverse every triangle from `(a, b, c)` to `(a, c, b)` without changing the input.
 *
 * @param indices - Triangle-list indices whose length is a multiple of three.
 * @returns A new index buffer with reversed winding.
 */
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

/**
 * Average normals in place for vertices whose positions match within `epsilon`.
 * This removes outline splits caused by duplicated vertices on hard geometry edges.
 *
 * @param positions - Packed XYZ vertex positions.
 * @param normals - Packed XYZ normals to update in place.
 * @param epsilon - Maximum per-axis positional difference for grouping vertices.
 */
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

/**
 * Compute the center of the axis-aligned local-space bounds.
 *
 * @param positions - Packed XYZ vertex positions.
 * @returns The bounds center as an XYZ tuple.
 */
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

/**
 * Measure one local-space bounds axis for normalized edge-flow effects.
 *
 * @param positions - Packed XYZ vertex positions.
 * @param axis - Axis to measure.
 * @returns The minimum coordinate and reciprocal extent. `invLength` is zero for a degenerate extent.
 */
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

/**
 * Read CPU geometry retained by a Babylon Lite mesh loader or mesh-data helper.
 *
 * @param mesh - Mesh whose retained position, normal, and index buffers should be inspected.
 * @returns Outline-compatible geometry, or `null` when any required CPU buffer was not retained.
 */
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
