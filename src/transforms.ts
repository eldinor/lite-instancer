import type { Mat4 } from "@babylonjs/lite";
import type { InstanceTransformInput, QuatLike, Vec3Like } from "./types.js";

/** Create a column-major identity matrix compatible with Babylon Lite `Mat4`. */
export function createIdentityMat4(): Mat4 {
  const out = new Float32Array(16);
  out[0] = 1;
  out[5] = 1;
  out[10] = 1;
  out[15] = 1;
  return out as Mat4;
}

/** Copy a matrix into `out`, or into a new `Float32Array(16)` when omitted. */
export function copyMat4(matrix: Mat4, out: Mat4 = new Float32Array(16) as Mat4): Mat4 {
  (out as Float32Array).set(matrix);
  return out;
}

/** Return true when a transform input is already a 4x4 matrix. */
export function isMat4Input(value: InstanceTransformInput): value is Mat4 {
  return ArrayBuffer.isView(value) && (value as ArrayBufferView & { length?: number }).length === 16;
}

/** Compose a matrix from a matrix input or `{ position, rotationQuaternion, rotationEuler, scale }`. */
export function composeMat4(input?: InstanceTransformInput): Mat4 {
  if (input === undefined) {
    return createIdentityMat4();
  }
  if (isMat4Input(input)) {
    return copyMat4(input);
  }

  const position = input.position ?? [0, 0, 0];
  const scale = normalizeScale(input.scale);
  const q = input.rotationQuaternion ?? eulerToQuat(input.rotationEuler ?? [0, 0, 0]);
  return fromRotationTranslationScale(q, position, scale);
}

/** Write a zero-scale matrix that preserves translation. Used by `"scale-zero"` visibility. */
export function writeZeroScale(matrix: Mat4, out: Mat4 = new Float32Array(16) as Mat4): Mat4 {
  const writable = out as Float32Array;
  writable.fill(0);
  writable[12] = matrix[12] ?? 0;
  writable[13] = matrix[13] ?? 0;
  writable[14] = matrix[14] ?? 0;
  writable[15] = 1;
  return out;
}

function normalizeScale(scale: Vec3Like | number | undefined): Vec3Like {
  if (scale === undefined) {
    return [1, 1, 1];
  }
  if (typeof scale === "number") {
    return [scale, scale, scale];
  }
  return scale;
}

function eulerToQuat(euler: Vec3Like): QuatLike {
  const x = euler[0] * 0.5;
  const y = euler[1] * 0.5;
  const z = euler[2] * 0.5;
  const sx = Math.sin(x);
  const cx = Math.cos(x);
  const sy = Math.sin(y);
  const cy = Math.cos(y);
  const sz = Math.sin(z);
  const cz = Math.cos(z);

  return [
    sx * cy * cz + cx * sy * sz,
    cx * sy * cz - sx * cy * sz,
    cx * cy * sz + sx * sy * cz,
    cx * cy * cz - sx * sy * sz
  ];
}

function fromRotationTranslationScale(q: QuatLike, v: Vec3Like, s: Vec3Like): Mat4 {
  const x = q[0];
  const y = q[1];
  const z = q[2];
  const w = q[3];
  const x2 = x + x;
  const y2 = y + y;
  const z2 = z + z;
  const xx = x * x2;
  const xy = x * y2;
  const xz = x * z2;
  const yy = y * y2;
  const yz = y * z2;
  const zz = z * z2;
  const wx = w * x2;
  const wy = w * y2;
  const wz = w * z2;
  const sx = s[0];
  const sy = s[1];
  const sz = s[2];
  const out = new Float32Array(16);

  out[0] = (1 - (yy + zz)) * sx;
  out[1] = (xy + wz) * sx;
  out[2] = (xz - wy) * sx;
  out[3] = 0;
  out[4] = (xy - wz) * sy;
  out[5] = (1 - (xx + zz)) * sy;
  out[6] = (yz + wx) * sy;
  out[7] = 0;
  out[8] = (xz + wy) * sz;
  out[9] = (yz - wx) * sz;
  out[10] = (1 - (xx + yy)) * sz;
  out[11] = 0;
  out[12] = v[0];
  out[13] = v[1];
  out[14] = v[2];
  out[15] = 1;
  return out as Mat4;
}
