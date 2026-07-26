import type { InteractionPickDetails } from "./types.js";

/** Interpolate an item-sized numeric vertex attribute at a detailed pick location. */
export function interpolatePickedAttribute(
  details: InteractionPickDetails,
  values: ArrayLike<number>,
  itemSize: number,
  out: Float32Array = new Float32Array(itemSize)
): Float32Array | null {
  if (!Number.isInteger(itemSize) || itemSize <= 0) {
    throw new RangeError("itemSize must be a positive integer.");
  }
  if (out.length < itemSize) {
    throw new RangeError("The output array is smaller than itemSize.");
  }
  const indices = details.vertexIndices;
  if (!indices) return null;
  const [i0, i1, i2] = indices;
  if ((Math.max(i0, i1, i2) + 1) * itemSize > values.length) return null;
  const [w0, w1, w2] = details.barycentric;
  for (let component = 0; component < itemSize; component++) {
    out[component] =
      values[i0 * itemSize + component]! * w0 +
      values[i1 * itemSize + component]! * w1 +
      values[i2 * itemSize + component]! * w2;
  }
  return out;
}
