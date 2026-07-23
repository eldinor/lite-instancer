import type { VatSocketAsset } from "./vat-socket-asset.js";

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

/** Portable metadata with a Babylon.js-native matrix VAT payload. */
export interface BabylonVatAsset {
  readonly version: 1;
  readonly encoding: "babylon-matrix-vat";
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

export interface EncodedBabylonVatAsset {
  readonly manifest: string;
  readonly payload: ArrayBuffer;
}

interface SerializedSocketAsset {
  version: 1;
  space: VatSocketAsset["space"];
  basis: number[];
  clips: VatSocketAsset["clips"];
  sockets: Record<string, Record<string, { translations: number[]; rotations: number[]; scales?: number[] }>>;
}

interface BabylonVatAssetManifest extends Omit<BabylonVatAsset, "frameData" | "sockets"> {
  readonly payload: { readonly byteLength: number; readonly littleEndian: true };
  readonly sockets?: SerializedSocketAsset;
}

export function validateBabylonVatAsset(asset: BabylonVatAsset): void {
  if (!asset || typeof asset !== "object") throw new Error("Babylon VAT asset must be an object.");
  if (asset.version !== 1) throw new Error(`Unsupported Babylon VAT asset version '${String(asset.version)}'.`);
  if (asset.encoding !== "babylon-matrix-vat") throw new Error(`Unsupported Babylon VAT encoding '${String(asset.encoding)}'.`);
  if (asset.basis !== "gltf-rh-model-world") throw new Error(`Unsupported Babylon VAT basis '${String(asset.basis)}'.`);
  assertPositiveInteger(asset.boneCount, "boneCount");
  assertPositiveInteger(asset.frameCount, "frameCount");
  if (!asset.texture || typeof asset.texture !== "object") throw new Error("Babylon VAT texture metadata is required.");
  if (asset.texture.format !== "rgba32float") throw new Error("Babylon VAT texture format must be rgba32float.");
  if (asset.texture.width !== (asset.boneCount + 1) * 4 || asset.texture.height !== asset.frameCount) {
    throw new Error("Babylon VAT texture dimensions do not match boneCount and frameCount.");
  }
  const expectedFloats = checkedProduct(asset.boneCount + 1, asset.frameCount, 16);
  if (!(asset.frameData instanceof Float32Array) || asset.frameData.length !== expectedFloats) {
    throw new Error(`Babylon VAT frameData must contain exactly ${expectedFloats} floats.`);
  }
  assertFiniteArray(asset.frameData, "Babylon VAT frameData");
  if (!asset.clips || typeof asset.clips !== "object" || Array.isArray(asset.clips)) {
    throw new Error("Babylon VAT clips must be an object.");
  }
  const clipEntries = Object.entries(asset.clips);
  if (clipEntries.length === 0) throw new Error("Babylon VAT asset requires at least one clip.");
  for (const [name, clip] of clipEntries) {
    if (!name) throw new Error("Babylon VAT clip names cannot be empty.");
    assertNonNegativeInteger(clip.fromRow, `clips.${name}.fromRow`);
    assertPositiveInteger(clip.frameCount, `clips.${name}.frameCount`);
    assertPositiveFinite(clip.fps, `clips.${name}.fps`);
    if (clip.fromRow + clip.frameCount > asset.frameCount) {
      throw new Error(`Babylon VAT clip '${name}' exceeds the frame atlas.`);
    }
  }
  if (asset.bounds) validateAnimatedBounds(asset.bounds, asset.clips);
  if (asset.sockets) validateSocketAsset(asset.sockets, asset.clips);
  if (asset.integrity !== undefined && asset.integrity !== computeBabylonVatAssetIntegrity(asset.frameData)) {
    throw new Error("Babylon VAT payload integrity check failed.");
  }
}

export function encodeBabylonVatAsset(asset: BabylonVatAsset): EncodedBabylonVatAsset {
  validateBabylonVatAsset(asset);
  const { frameData: _frameData, sockets, ...metadata } = asset;
  const manifest: BabylonVatAssetManifest = {
    ...metadata,
    payload: { byteLength: frameDataByteLength(asset.frameData), littleEndian: true },
    ...(sockets ? { sockets: serializeSockets(sockets) } : {})
  };
  const payload = asset.frameData.buffer.slice(
    asset.frameData.byteOffset,
    asset.frameData.byteOffset + asset.frameData.byteLength
  ) as ArrayBuffer;
  return { manifest: stableStringify(manifest), payload };
}

export function decodeBabylonVatAsset(manifestJson: string, payload: ArrayBuffer): BabylonVatAsset {
  let parsed: Partial<BabylonVatAssetManifest>;
  try {
    parsed = JSON.parse(manifestJson) as Partial<BabylonVatAssetManifest>;
  } catch {
    throw new Error("Babylon VAT manifest is not valid JSON.");
  }
  if (parsed.payload?.littleEndian !== true || parsed.payload.byteLength !== payload.byteLength) {
    throw new Error("Babylon VAT payload length does not match its manifest.");
  }
  if (payload.byteLength % Float32Array.BYTES_PER_ELEMENT !== 0) {
    throw new Error("Babylon VAT payload byte length must be divisible by four.");
  }
  const asset: BabylonVatAsset = {
    version: parsed.version as 1,
    encoding: parsed.encoding as "babylon-matrix-vat",
    basis: parsed.basis as VatAssetBasis,
    boneCount: parsed.boneCount as number,
    frameCount: parsed.frameCount as number,
    texture: parsed.texture as BabylonVatAsset["texture"],
    clips: parsed.clips as BabylonVatAsset["clips"],
    frameData: new Float32Array(payload.slice(0)),
    ...(parsed.sockets ? { sockets: deserializeSockets(parsed.sockets) } : {}),
    ...(parsed.bounds ? { bounds: parsed.bounds } : {}),
    ...(parsed.source ? { source: parsed.source } : {}),
    ...(parsed.integrity ? { integrity: parsed.integrity } : {})
  };
  validateBabylonVatAsset(asset);
  return asset;
}

export function computeBabylonVatAssetIntegrity(frameData: Float32Array): string {
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
    const serialized: SerializedSocketAsset["sockets"][string] = {};
    for (const [clipName, track] of Object.entries(clips)) {
      serialized[clipName] = {
        translations: Array.from(track.translations),
        rotations: Array.from(track.rotations),
        ...(track.scales ? { scales: Array.from(track.scales) } : {})
      };
    }
    sockets[socketName] = serialized;
  }
  return { version: 1, space: asset.space, basis: Array.from(asset.basis), clips: asset.clips, sockets };
}

function deserializeSockets(asset: SerializedSocketAsset): VatSocketAsset {
  if (!asset || typeof asset !== "object" || !asset.sockets || typeof asset.sockets !== "object") {
    throw new Error("Babylon VAT socket metadata is invalid.");
  }
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

function validateSocketAsset(sockets: VatSocketAsset, clips: BabylonVatAsset["clips"]): void {
  if (sockets.version !== 1 || sockets.space !== "gltf-rh-model-world" || sockets.basis.length !== 16) {
    throw new Error("Babylon VAT socket asset has an unsupported version, space, or basis.");
  }
  assertFiniteArray(sockets.basis, "Babylon VAT socket basis");
  for (const [socketName, tracks] of Object.entries(sockets.sockets)) {
    if (!socketName) throw new Error("Babylon VAT socket names cannot be empty.");
    for (const [clipName, track] of Object.entries(tracks)) {
      const clip = clips[clipName];
      if (!clip) throw new Error(`Socket '${socketName}' references unknown clip '${clipName}'.`);
      if (track.translations.length !== clip.frameCount * 3 || track.rotations.length !== clip.frameCount * 4) {
        throw new Error(`Socket '${socketName}' has invalid track lengths for clip '${clipName}'.`);
      }
      if (track.scales && track.scales.length !== clip.frameCount * 3) {
        throw new Error(`Socket '${socketName}' has an invalid scale track for clip '${clipName}'.`);
      }
      assertFiniteArray(track.translations, `Socket '${socketName}' translations`);
      assertFiniteArray(track.rotations, `Socket '${socketName}' rotations`);
      if (track.scales) assertFiniteArray(track.scales, `Socket '${socketName}' scales`);
    }
  }
}

function validateAnimatedBounds(bounds: VatAssetAnimatedBounds, clips: BabylonVatAsset["clips"]): void {
  if (!bounds.model) throw new Error("Babylon VAT animated bounds require model bounds.");
  validateBounds(bounds.model, "bounds.model");
  for (const [name, clipBounds] of Object.entries(bounds.clips ?? {})) {
    if (!clips[name]) throw new Error(`Animated bounds reference unknown clip '${name}'.`);
    validateBounds(clipBounds, `bounds.clips.${name}`);
  }
}

function validateBounds(bounds: VatAssetBounds, label: string): void {
  if (!bounds || !bounds.min || !bounds.max || bounds.min.length !== 3 || bounds.max.length !== 3) {
    throw new Error(`${label} must contain min/max vec3 values.`);
  }
  for (let axis = 0; axis < 3; axis++) {
    const minimum = bounds.min[axis] ?? Number.NaN;
    const maximum = bounds.max[axis] ?? Number.NaN;
    if (!Number.isFinite(minimum) || !Number.isFinite(maximum) || minimum > maximum) throw new Error(`${label} is invalid.`);
  }
}

function stableStringify(value: unknown): string {
  return JSON.stringify(sortJson(value));
}

function sortJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortJson);
  if (value && typeof value === "object") {
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(value).sort()) sorted[key] = sortJson((value as Record<string, unknown>)[key]);
    return sorted;
  }
  return value;
}

function checkedProduct(...values: number[]): number {
  let result = 1;
  for (const value of values) {
    result *= value;
    if (!Number.isSafeInteger(result)) throw new Error("Babylon VAT allocation size exceeds the safe integer range.");
  }
  return result;
}
function frameDataByteLength(data: Float32Array): number { return checkedProduct(data.length, Float32Array.BYTES_PER_ELEMENT); }
function assertPositiveInteger(value: number, label: string): void { if (!Number.isInteger(value) || value <= 0) throw new Error(`${label} must be a positive integer.`); }
function assertNonNegativeInteger(value: number, label: string): void { if (!Number.isInteger(value) || value < 0) throw new Error(`${label} must be a non-negative integer.`); }
function assertPositiveFinite(value: number, label: string): void { if (!Number.isFinite(value) || value <= 0) throw new Error(`${label} must be positive and finite.`); }
function assertFiniteArray(values: ArrayLike<number>, label: string): void {
  for (let index = 0; index < values.length; index++) if (!Number.isFinite(values[index])) throw new Error(`${label} contains a non-finite value.`);
}
