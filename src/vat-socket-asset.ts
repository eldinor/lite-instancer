import type { VatPlaybackSample } from "./vat-instance-set.js";

/** VAT clip metadata shared by socket tracks and playback sampling. */
export interface VatSocketClip {
  readonly name: string;
  readonly fps: number;
  readonly frameCount: number;
  readonly durationSeconds: number;
}

/** A decomposed transform track. Values are packed per frame as XYZ and XYZW. */
export interface VatSocketTransformTrack {
  readonly translations: Float32Array;
  readonly rotations: Float32Array;
  readonly scales?: Float32Array;
}

/** Versioned, serializable socket data baked alongside a VAT animation rig. */
export interface VatSocketAsset {
  readonly version: 1;
  /** Identifies the transform convention used by this asset. */
  readonly space: "gltf-rh-model-world";
  /** Model-space basis that converts a sampled socket into Lite VAT space. */
  readonly basis: Float32Array;
  readonly clips: Readonly<Record<string, VatSocketClip>>;
  readonly sockets: Readonly<Record<string, Readonly<Record<string, VatSocketTransformTrack>>>>;
}

/** Reusable output for socket sampling. */
export interface VatSocketTransform {
  translation: Float32Array;
  rotation: Float32Array;
  scale: Float32Array;
}

/** Sampling options. Exact-frame sampling is the default because Lite VAT uses discrete rows. */
export interface VatSocketSampleOptions {
  /** Interpolate between frames. This is smoother but does not exactly match discrete VAT rows. */
  interpolate?: boolean;
}

/** Allocate a reusable socket transform output. */
export function createVatSocketTransform(): VatSocketTransform {
  return {
    translation: new Float32Array(3),
    rotation: new Float32Array([0, 0, 0, 1]),
    scale: new Float32Array([1, 1, 1])
  };
}

/**
 * Sample a socket using the same clip and frame selected for VAT playback.
 * Exact sampling is the default because the current Lite VAT shader floors its frame row.
 */
export function sampleVatSocket(
  asset: VatSocketAsset,
  playback: VatPlaybackSample,
  socket: string,
  out: VatSocketTransform = createVatSocketTransform(),
  options: VatSocketSampleOptions = {}
): VatSocketTransform | undefined {
  const track = asset.sockets[socket]?.[playback.clip];
  const clip = asset.clips[playback.clip];
  if (!track || !clip || track.translations.length !== clip.frameCount * 3 || track.rotations.length !== clip.frameCount * 4) {
    return undefined;
  }

  const frame = normalizeFrame(playback.frame, clip.frameCount);
  const nextFrame = normalizeFrame(playback.nextFrame, clip.frameCount);
  if (options.interpolate && playback.alpha > 0) {
    lerp3(track.translations, frame * 3, track.translations, nextFrame * 3, playback.alpha, out.translation);
    slerp(track.rotations, frame * 4, track.rotations, nextFrame * 4, playback.alpha, out.rotation);
    if (track.scales) {
      lerp3(track.scales, frame * 3, track.scales, nextFrame * 3, playback.alpha, out.scale);
    } else {
      out.scale[0] = 1;
      out.scale[1] = 1;
      out.scale[2] = 1;
    }
    return out;
  }

  copy3(track.translations, frame * 3, out.translation);
  copy4(track.rotations, frame * 4, out.rotation);
  if (track.scales) {
    copy3(track.scales, frame * 3, out.scale);
  } else {
    out.scale[0] = 1;
    out.scale[1] = 1;
    out.scale[2] = 1;
  }
  return out;
}

function normalizeFrame(frame: number, frameCount: number): number {
  const count = Math.max(1, frameCount);
  const value = Math.floor(frame);
  return ((value % count) + count) % count;
}

function copy3(source: Float32Array, offset: number, out: Float32Array): void {
  out[0] = source[offset] ?? 0;
  out[1] = source[offset + 1] ?? 0;
  out[2] = source[offset + 2] ?? 0;
}

function copy4(source: Float32Array, offset: number, out: Float32Array): void {
  out[0] = source[offset] ?? 0;
  out[1] = source[offset + 1] ?? 0;
  out[2] = source[offset + 2] ?? 0;
  out[3] = source[offset + 3] ?? 1;
}

function lerp3(a: Float32Array, aOffset: number, b: Float32Array, bOffset: number, t: number, out: Float32Array): void {
  out[0] = (a[aOffset] ?? 0) + ((b[bOffset] ?? 0) - (a[aOffset] ?? 0)) * t;
  out[1] = (a[aOffset + 1] ?? 0) + ((b[bOffset + 1] ?? 0) - (a[aOffset + 1] ?? 0)) * t;
  out[2] = (a[aOffset + 2] ?? 0) + ((b[bOffset + 2] ?? 0) - (a[aOffset + 2] ?? 0)) * t;
}

function slerp(a: Float32Array, aOffset: number, b: Float32Array, bOffset: number, t: number, out: Float32Array): void {
  let ax = a[aOffset] ?? 0;
  let ay = a[aOffset + 1] ?? 0;
  let az = a[aOffset + 2] ?? 0;
  let aw = a[aOffset + 3] ?? 1;
  let bx = b[bOffset] ?? 0;
  let by = b[bOffset + 1] ?? 0;
  let bz = b[bOffset + 2] ?? 0;
  let bw = b[bOffset + 3] ?? 1;
  let dot = ax * bx + ay * by + az * bz + aw * bw;
  if (dot < 0) {
    dot = -dot;
    bx = -bx;
    by = -by;
    bz = -bz;
    bw = -bw;
  }
  if (dot > 0.9995) {
    out[0] = ax + (bx - ax) * t;
    out[1] = ay + (by - ay) * t;
    out[2] = az + (bz - az) * t;
    out[3] = aw + (bw - aw) * t;
  } else {
    const theta = Math.acos(Math.min(1, Math.max(-1, dot)));
    const sinTheta = Math.sin(theta);
    const aWeight = Math.sin((1 - t) * theta) / sinTheta;
    const bWeight = Math.sin(t * theta) / sinTheta;
    out[0] = ax * aWeight + bx * bWeight;
    out[1] = ay * aWeight + by * bWeight;
    out[2] = az * aWeight + bz * bWeight;
    out[3] = aw * aWeight + bw * bWeight;
  }
  const length = Math.hypot(out[0] ?? 0, out[1] ?? 0, out[2] ?? 0, out[3] ?? 1) || 1;
  out[0] = (out[0] ?? 0) / length;
  out[1] = (out[1] ?? 0) / length;
  out[2] = (out[2] ?? 0) / length;
  out[3] = (out[3] ?? 1) / length;
}
