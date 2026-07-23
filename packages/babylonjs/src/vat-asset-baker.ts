import type { AnimationGroup } from "@babylonjs/core/Animations/animationGroup.js";
import type { Mesh } from "@babylonjs/core/Meshes/mesh.js";
import {
  computeBabylonVatAssetIntegrity,
  validateBabylonVatAsset,
  type BabylonVatAsset,
  type VatAssetAnimatedBounds,
  type VatAssetClip,
  type VatAssetSourceMetadata
} from "./vat-asset.js";
import type { VatSocketAsset } from "./vat-socket-asset.js";

export interface BabylonVatBakeLimits {
  readonly maxModelBytes: number;
  readonly maxBones: number;
  readonly maxFramesPerClip: number;
  readonly maxTotalFrames: number;
  readonly maxAtlasBytes: number;
  readonly maxAnimations: number;
}

export const DEFAULT_BABYLON_VAT_BAKE_LIMITS: BabylonVatBakeLimits = Object.freeze({
  maxModelBytes: 256 * 1024 * 1024,
  maxBones: 512,
  maxFramesPerClip: 36_000,
  maxTotalFrames: 100_000,
  maxAtlasBytes: 1024 * 1024 * 1024,
  maxAnimations: 512
});

export interface BabylonVatSampledMatrices {
  readonly boneCount: number;
  readonly clips: Readonly<Record<string, VatAssetClip>>;
  readonly frameData: Float32Array;
  readonly sourceBytes?: number;
  readonly sockets?: VatSocketAsset;
  readonly bounds?: VatAssetAnimatedBounds;
  readonly source?: VatAssetSourceMetadata;
}

export interface BabylonVatBakeOptions {
  readonly sourceBytes?: number;
  readonly sockets?: VatSocketAsset;
  readonly bounds?: VatAssetAnimatedBounds;
  readonly source?: VatAssetSourceMetadata;
  readonly limits?: BabylonVatBakeLimits;
}

/** Pack already sampled Babylon matrices into the portable envelope. */
export function packBabylonVatAsset(
  input: BabylonVatSampledMatrices,
  limits: BabylonVatBakeLimits = DEFAULT_BABYLON_VAT_BAKE_LIMITS
): BabylonVatAsset {
  validateLimits(limits);
  if (input.sourceBytes !== undefined && input.sourceBytes > limits.maxModelBytes) {
    throw limitError("model bytes", input.sourceBytes, limits.maxModelBytes);
  }
  if (input.boneCount > limits.maxBones) throw limitError("bones", input.boneCount, limits.maxBones);
  const entries = Object.entries(input.clips);
  if (entries.length > limits.maxAnimations) throw limitError("animations", entries.length, limits.maxAnimations);
  let frameCount = 0;
  for (const [name, clip] of entries) {
    if (clip.frameCount > limits.maxFramesPerClip) {
      throw limitError(`frames in clip '${name}'`, clip.frameCount, limits.maxFramesPerClip);
    }
    frameCount = Math.max(frameCount, clip.fromRow + clip.frameCount);
  }
  if (frameCount > limits.maxTotalFrames) throw limitError("total frames", frameCount, limits.maxTotalFrames);
  if (input.frameData.byteLength > limits.maxAtlasBytes) {
    throw limitError("atlas bytes", input.frameData.byteLength, limits.maxAtlasBytes);
  }
  const asset: BabylonVatAsset = {
    version: 1,
    encoding: "babylon-matrix-vat",
    basis: "gltf-rh-model-world",
    boneCount: input.boneCount,
    frameCount,
    texture: { width: (input.boneCount + 1) * 4, height: frameCount, format: "rgba32float" },
    clips: input.clips,
    frameData: input.frameData,
    integrity: computeBabylonVatAssetIntegrity(input.frameData),
    ...(input.sockets ? { sockets: input.sockets } : {}),
    ...(input.bounds ? { bounds: input.bounds } : {}),
    ...(input.source ? { source: input.source } : {})
  };
  validateBabylonVatAsset(asset);
  return asset;
}

/** Bake Babylon.js AnimationGroups into a portable asset for offline persistence. */
export function bakeBabylonVatAsset(
  mesh: Mesh,
  groups: AnimationGroup[],
  options: BabylonVatBakeOptions = {}
): BabylonVatAsset {
  const skeleton = mesh.skeleton;
  if (!skeleton) throw new Error("Babylon VAT baking requires a skinned mesh.");
  if (groups.length === 0) throw new Error("Babylon VAT baking requires at least one animation group.");
  const limits = options.limits ?? DEFAULT_BABYLON_VAT_BAKE_LIMITS;
  validateLimits(limits);
  const clips = collectBabylonVatAssetClips(groups);
  const frameCount = Object.values(clips).reduce((max, clip) => Math.max(max, clip.fromRow + clip.frameCount), 0);
  const estimatedBytes = checkedProduct(skeleton.bones.length + 1, frameCount, 16, Float32Array.BYTES_PER_ELEMENT);
  if (estimatedBytes > limits.maxAtlasBytes) throw limitError("atlas bytes", estimatedBytes, limits.maxAtlasBytes);
  if (skeleton.bones.length > limits.maxBones) throw limitError("bones", skeleton.bones.length, limits.maxBones);
  if (groups.length > limits.maxAnimations) throw limitError("animations", groups.length, limits.maxAnimations);
  if (frameCount > limits.maxTotalFrames) throw limitError("total frames", frameCount, limits.maxTotalFrames);
  for (const [name, clip] of Object.entries(clips)) {
    if (clip.frameCount > limits.maxFramesPerClip) throw limitError(`frames in clip '${name}'`, clip.frameCount, limits.maxFramesPerClip);
  }
  return packBabylonVatAsset({
    boneCount: skeleton.bones.length,
    clips,
    frameData: bakeBabylonAnimationGroupsSync(mesh, groups),
    ...(options.sourceBytes === undefined ? {} : { sourceBytes: options.sourceBytes }),
    ...(options.sockets ? { sockets: options.sockets } : {}),
    ...(options.bounds ? { bounds: options.bounds } : {}),
    ...(options.source ? { source: options.source } : {})
  }, limits);
}

export function collectBabylonVatAssetClips(groups: AnimationGroup[]): Record<string, VatAssetClip> {
  const clips: Record<string, VatAssetClip> = {};
  let row = 0;
  for (const group of groups) {
    const from = Math.floor(group.from);
    const to = Math.floor(group.to);
    if (!group.name || !Number.isFinite(from) || !Number.isFinite(to) || to < from) {
      throw new Error(`Invalid Babylon VAT animation group '${group.name}'.`);
    }
    if (clips[group.name]) throw new Error(`Duplicate Babylon VAT clip '${group.name}'.`);
    const frameCount = to - from + 1;
    clips[group.name] = {
      fromRow: row,
      frameCount,
      fps: group.targetedAnimations[0]?.animation.framePerSecond ?? 30
    };
    row += frameCount;
  }
  return clips;
}

/** Sample AnimationGroups in final atlas order. Intended for offline tools and explicit runtime baking. */
export function bakeBabylonAnimationGroupsSync(mesh: Mesh, groups: AnimationGroup[]): Float32Array {
  const skeleton = mesh.skeleton;
  if (!skeleton) throw new Error("Babylon VAT baking requires a skinned mesh.");
  const clips = collectBabylonVatAssetClips(groups);
  const frameCount = Object.values(clips).reduce((total, clip) => total + clip.frameCount, 0);
  const floatsPerFrame = (skeleton.bones.length + 1) * 16;
  const data = new Float32Array(checkedProduct(floatsPerFrame, frameCount));
  let row = 0;
  for (const group of groups) group.stop(true);
  skeleton.returnToRest();
  for (const group of groups) {
    const from = Math.floor(group.from);
    const to = Math.floor(group.to);
    group.start(false, 1, from, to);
    for (let frame = from; frame <= to; frame++) {
      group.goToFrame(frame);
      // goToFrame applies values synchronously. Preparing the skeleton copies
      // linked TransformNode values and computes the CPU matrix palette without
      // submitting a swap-chain frame, which is required for safe WebGPU baking.
      skeleton.prepare(true);
      skeleton.computeAbsoluteMatrices(true);
      data.set(skeleton.getTransformMatrices(mesh), row * floatsPerFrame);
      row++;
    }
    group.stop(true);
  }
  skeleton.returnToRest();
  return data;
}

function validateLimits(limits: BabylonVatBakeLimits): void {
  for (const [name, value] of Object.entries(limits)) {
    if (!Number.isFinite(value) || value <= 0) throw new Error(`Babylon VAT limit '${name}' must be positive and finite.`);
  }
}
function checkedProduct(...values: number[]): number {
  let result = 1;
  for (const value of values) {
    result *= value;
    if (!Number.isSafeInteger(result)) throw new Error("Babylon VAT allocation size exceeds the safe integer range.");
  }
  return result;
}
function limitError(label: string, actual: number, limit: number): Error {
  return new Error(`Babylon VAT ${label} limit exceeded (${actual} > ${limit}).`);
}
