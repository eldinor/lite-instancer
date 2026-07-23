import type { Vec3Like } from "./types.js";

export function copyMatrix16(source: Float32Array, offset: number, target: Float32Array): void {
  for (let index = 0; index < 16; index++) target[index] = source[offset + index] ?? 0;
}

export function swapMatrix16(buffer: Float32Array, aOffset: number, bOffset: number, scratch: Float32Array): void {
  copyMatrix16(buffer, aOffset, scratch);
  buffer.copyWithin(aOffset, bOffset, bOffset + 16);
  for (let index = 0; index < 16; index++) buffer[bOffset + index] = scratch[index] ?? 0;
}

export function readMatrixPosition(buffer: Float32Array, offset: number, out?: Float32Array): Float32Array {
  const target = out ?? new Float32Array(3);
  target[0] = buffer[offset + 12] ?? 0;
  target[1] = buffer[offset + 13] ?? 0;
  target[2] = buffer[offset + 14] ?? 0;
  return target;
}

export function writeMatrixPosition(buffer: Float32Array, offset: number, position: Vec3Like): void {
  buffer[offset + 12] = position[0];
  buffer[offset + 13] = position[1];
  buffer[offset + 14] = position[2];
}

export function translateMatrixPosition(buffer: Float32Array, offset: number, delta: Vec3Like): void {
  buffer[offset + 12] = (buffer[offset + 12] ?? 0) + delta[0];
  buffer[offset + 13] = (buffer[offset + 13] ?? 0) + delta[1];
  buffer[offset + 14] = (buffer[offset + 14] ?? 0) + delta[2];
}

export function writeMatrixScale(buffer: Float32Array, offset: number, scale: Vec3Like | number): void {
  const x = typeof scale === "number" ? scale : scale[0];
  const y = typeof scale === "number" ? scale : scale[1];
  const z = typeof scale === "number" ? scale : scale[2];
  rescaleColumn(buffer, offset, x, 0);
  rescaleColumn(buffer, offset + 4, y, 1);
  rescaleColumn(buffer, offset + 8, z, 2);
}

function rescaleColumn(buffer: Float32Array, offset: number, scale: number, axis: number): void {
  const x = buffer[offset] ?? 0;
  const y = buffer[offset + 1] ?? 0;
  const z = buffer[offset + 2] ?? 0;
  const length = Math.hypot(x, y, z);
  if (length < 1e-8) {
    buffer[offset] = axis === 0 ? scale : 0;
    buffer[offset + 1] = axis === 1 ? scale : 0;
    buffer[offset + 2] = axis === 2 ? scale : 0;
    return;
  }
  const factor = scale / length;
  buffer[offset] = x * factor;
  buffer[offset + 1] = y * factor;
  buffer[offset + 2] = z * factor;
}
