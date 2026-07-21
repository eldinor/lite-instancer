import type { VatSocketAsset } from "./vat-socket-asset.js";

export type VatAssetEncoding = "lite-matrix-rgba32float" | "babylon-matrix-vat";
export type VatAssetBasis = "gltf-rh-model-world";
export type VatVec3 = readonly [number, number, number];

export interface VatAssetClip {
  readonly fromRow: number;
  readonly frameCount: number;
  readonly fps: number;
}

export interface VatAssetBounds {
  readonly min: VatVec3;
  readonly max: VatVec3;
}

export interface VatAssetAnimatedBounds {
  readonly model: VatAssetBounds;
  readonly clips?: Readonly<Record<string, VatAssetBounds>>;
}

export interface VatAssetSourceMetadata {
  readonly name?: string;
  readonly uri?: string;
  readonly generator?: string;
  readonly hash?: string;
}

/** Portable runtime representation. Its GPU payload is deliberately engine-specific. */
export interface LiteVatAsset {
  readonly version: 1;
  readonly encoding: "lite-matrix-rgba32float";
  readonly basis: VatAssetBasis;
  readonly boneCount: number;
  readonly frameCount: number;
  readonly texture: {
    readonly width: number;
    readonly height: number;
    readonly format: "rgba32float";
  };
  readonly clips: Readonly<Record<string, VatAssetClip>>;
  readonly frameData: Float32Array;
  readonly sockets?: VatSocketAsset;
  readonly bounds?: VatAssetAnimatedBounds;
  readonly source?: VatAssetSourceMetadata;
  /** Non-cryptographic payload corruption check in `fnv1a32:0123abcd` form. */
  readonly integrity?: string;
}

export interface EncodedLiteVatAsset {
  readonly manifest: string;
  readonly payload: ArrayBuffer;
}

interface SerializedSocketAsset {
  version: 1;
  space: "gltf-rh-model-world";
  basis: number[];
  clips: VatSocketAsset["clips"];
  sockets: Record<string, Record<string, { translations: number[]; rotations: number[]; scales?: number[] }>>;
}

interface LiteVatAssetManifest extends Omit<LiteVatAsset, "frameData" | "sockets"> {
  readonly payload: { readonly byteLength: number; readonly littleEndian: true };
  readonly sockets?: SerializedSocketAsset;
}

export function validateLiteVatAsset(asset: LiteVatAsset): void {
  if (asset.version !== 1) throw new Error(`Unsupported Lite VAT asset version '${String(asset.version)}'.`);
  if (asset.encoding !== "lite-matrix-rgba32float") throw new Error(`Unsupported Lite VAT encoding '${String(asset.encoding)}'.`);
  if (asset.basis !== "gltf-rh-model-world") throw new Error(`Unsupported Lite VAT basis '${String(asset.basis)}'.`);
  assertPositiveInteger(asset.boneCount, "boneCount");
  assertPositiveInteger(asset.frameCount, "frameCount");
  if (asset.texture.format !== "rgba32float") throw new Error("Lite VAT texture format must be rgba32float.");
  if (asset.texture.width !== asset.boneCount * 4 || asset.texture.height !== asset.frameCount) {
    throw new Error("Lite VAT texture dimensions do not match boneCount and frameCount.");
  }
  const expectedFloats = checkedProduct(asset.boneCount, asset.frameCount, 16);
  if (!(asset.frameData instanceof Float32Array) || asset.frameData.length !== expectedFloats) {
    throw new Error(`Lite VAT frameData must contain exactly ${expectedFloats} floats.`);
  }
  for (const value of asset.frameData) {
    if (!Number.isFinite(value)) throw new Error("Lite VAT frameData contains a non-finite value.");
  }
  const clipEntries = Object.entries(asset.clips);
  if (clipEntries.length === 0) throw new Error("Lite VAT asset requires at least one clip.");
  for (const [name, clip] of clipEntries) {
    if (!name) throw new Error("Lite VAT clip names cannot be empty.");
    assertNonNegativeInteger(clip.fromRow, `clips.${name}.fromRow`);
    assertPositiveInteger(clip.frameCount, `clips.${name}.frameCount`);
    assertPositiveFinite(clip.fps, `clips.${name}.fps`);
    if (clip.fromRow + clip.frameCount > asset.frameCount) {
      throw new Error(`Lite VAT clip '${name}' exceeds the frame atlas.`);
    }
  }
  if (asset.bounds) validateAnimatedBounds(asset.bounds, asset.clips);
  if (asset.sockets) validateSocketAsset(asset.sockets, asset.clips);
  if (asset.integrity !== undefined && asset.integrity !== computeLiteVatAssetIntegrity(asset.frameData)) {
    throw new Error("Lite VAT payload integrity check failed.");
  }
}

export function encodeLiteVatAsset(asset: LiteVatAsset): EncodedLiteVatAsset {
  validateLiteVatAsset(asset);
  const { frameData: _frameData, sockets, ...metadata } = asset;
  const manifest: LiteVatAssetManifest = {
    ...metadata,
    payload: { byteLength: frameDataByteLength(asset.frameData), littleEndian: true },
    ...(sockets ? { sockets: serializeSockets(sockets) } : {})
  };
  const payload = asset.frameData.buffer.slice(
    asset.frameData.byteOffset,
    asset.frameData.byteOffset + asset.frameData.byteLength
  ) as ArrayBuffer;
  return { manifest: JSON.stringify(manifest), payload };
}

export function decodeLiteVatAsset(manifestJson: string, payload: ArrayBuffer): LiteVatAsset {
  const parsed = JSON.parse(manifestJson) as Partial<LiteVatAssetManifest>;
  if (parsed.payload?.littleEndian !== true || parsed.payload.byteLength !== payload.byteLength) {
    throw new Error("Lite VAT payload length does not match its manifest.");
  }
  if (payload.byteLength % Float32Array.BYTES_PER_ELEMENT !== 0) {
    throw new Error("Lite VAT payload byte length must be divisible by four.");
  }
  const asset: LiteVatAsset = {
    version: parsed.version as 1,
    encoding: parsed.encoding as "lite-matrix-rgba32float",
    basis: parsed.basis as VatAssetBasis,
    boneCount: parsed.boneCount as number,
    frameCount: parsed.frameCount as number,
    texture: parsed.texture as LiteVatAsset["texture"],
    clips: parsed.clips as LiteVatAsset["clips"],
    frameData: new Float32Array(payload.slice(0)),
    ...(parsed.sockets ? { sockets: deserializeSockets(parsed.sockets) } : {}),
    ...(parsed.bounds ? { bounds: parsed.bounds } : {}),
    ...(parsed.source ? { source: parsed.source } : {}),
    ...(parsed.integrity ? { integrity: parsed.integrity } : {})
  };
  validateLiteVatAsset(asset);
  return asset;
}

export function computeLiteVatAssetIntegrity(frameData: Float32Array): string {
  const bytes = new Uint8Array(frameData.buffer, frameData.byteOffset, frameData.byteLength);
  let hash = 0x811c9dc5;
  for (const byte of bytes) {
    hash ^= byte;
    hash = Math.imul(hash, 0x01000193);
  }
  return `fnv1a32:${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

function serializeSockets(asset: VatSocketAsset): SerializedSocketAsset {
  const sockets: SerializedSocketAsset["sockets"] = {};
  for (const [socketName, clips] of Object.entries(asset.sockets)) {
    const serializedClips: SerializedSocketAsset["sockets"][string] = {};
    for (const [clipName, track] of Object.entries(clips)) {
      serializedClips[clipName] = {
        translations: Array.from(track.translations),
        rotations: Array.from(track.rotations),
        ...(track.scales ? { scales: Array.from(track.scales) } : {})
      };
    }
    sockets[socketName] = serializedClips;
  }
  return { version: 1, space: asset.space, basis: Array.from(asset.basis), clips: asset.clips, sockets };
}

function deserializeSockets(asset: SerializedSocketAsset): VatSocketAsset {
  const sockets: Record<string, Record<string, { translations: Float32Array; rotations: Float32Array; scales?: Float32Array }>> = {};
  for (const [socketName, clips] of Object.entries(asset.sockets)) {
    const decoded: Record<string, { translations: Float32Array; rotations: Float32Array; scales?: Float32Array }> = {};
    for (const [clipName, track] of Object.entries(clips)) {
      decoded[clipName] = {
        translations: new Float32Array(track.translations),
        rotations: new Float32Array(track.rotations),
        ...(track.scales ? { scales: new Float32Array(track.scales) } : {})
      };
    }
    sockets[socketName] = decoded;
  }
  return { version: 1, space: asset.space, basis: new Float32Array(asset.basis), clips: asset.clips, sockets };
}

function validateSocketAsset(sockets: VatSocketAsset, clips: LiteVatAsset["clips"]): void {
  if (sockets.version !== 1 || sockets.space !== "gltf-rh-model-world" || sockets.basis.length !== 16) {
    throw new Error("Lite VAT socket asset has an unsupported version, space, or basis.");
  }
  for (const [socketName, tracks] of Object.entries(sockets.sockets)) {
    for (const [clipName, track] of Object.entries(tracks)) {
      const clip = clips[clipName];
      if (!clip) throw new Error(`Socket '${socketName}' references unknown clip '${clipName}'.`);
      if (track.translations.length !== clip.frameCount * 3 || track.rotations.length !== clip.frameCount * 4) {
        throw new Error(`Socket '${socketName}' has invalid track lengths for clip '${clipName}'.`);
      }
      if (track.scales && track.scales.length !== clip.frameCount * 3) {
        throw new Error(`Socket '${socketName}' has an invalid scale track for clip '${clipName}'.`);
      }
    }
  }
}

function validateAnimatedBounds(bounds: VatAssetAnimatedBounds, clips: LiteVatAsset["clips"]): void {
  validateBounds(bounds.model, "bounds.model");
  for (const [name, clipBounds] of Object.entries(bounds.clips ?? {})) {
    if (!clips[name]) throw new Error(`Animated bounds reference unknown clip '${name}'.`);
    validateBounds(clipBounds, `bounds.clips.${name}`);
  }
}

function validateBounds(bounds: VatAssetBounds, label: string): void {
  if (bounds.min.length !== 3 || bounds.max.length !== 3) throw new Error(`${label} must contain min/max vec3 values.`);
  for (let axis = 0; axis < 3; axis++) {
    const min = bounds.min[axis]!;
    const max = bounds.max[axis]!;
    if (!Number.isFinite(min) || !Number.isFinite(max) || min > max) throw new Error(`${label} is invalid.`);
  }
}

function checkedProduct(...values: number[]): number {
  let result = 1;
  for (const value of values) {
    result *= value;
    if (!Number.isSafeInteger(result)) throw new Error("Lite VAT allocation size exceeds the safe integer range.");
  }
  return result;
}

function frameDataByteLength(data: Float32Array): number {
  return checkedProduct(data.length, Float32Array.BYTES_PER_ELEMENT);
}

function assertPositiveInteger(value: number, label: string): void {
  if (!Number.isInteger(value) || value <= 0) throw new Error(`${label} must be a positive integer.`);
}

function assertNonNegativeInteger(value: number, label: string): void {
  if (!Number.isInteger(value) || value < 0) throw new Error(`${label} must be a non-negative integer.`);
}

function assertPositiveFinite(value: number, label: string): void {
  if (!Number.isFinite(value) || value <= 0) throw new Error(`${label} must be positive and finite.`);
}
