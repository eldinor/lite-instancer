import type { AnimationGroup } from "@babylonjs/core/Animations/animationGroup.js";
import type { AbstractEngine } from "@babylonjs/core/Engines/abstractEngine.js";
import { Matrix, Quaternion, Vector3 } from "@babylonjs/core/Maths/math.js";
import type { Node } from "@babylonjs/core/node.js";
import type { VatClip } from "./vat-instance-set.js";
import type { VatSocketAsset, VatSocketTransformTrack } from "./vat-socket-asset.js";

export interface BabylonVatSocketBakeOptions {
  /** Character hierarchy root used as the model-space origin. */
  readonly root: Node;
  /** Public socket keys mapped to Babylon nodes or descendant node names. */
  readonly sockets: Readonly<Record<string, Node | string>>;
  /** VAT clip metadata. Defaults to ranges derived from the animation groups. */
  readonly clips?: Readonly<Record<string, VatClip>>;
}

/**
 * Bake animated Babylon hierarchy nodes into compact model-space socket tracks.
 * Use the same AnimationGroups for this source hierarchy and the VAT character.
 */
export function bakeVatSocketAsset(
  engine: AbstractEngine,
  animationGroups: readonly AnimationGroup[],
  options: BabylonVatSocketBakeOptions
): VatSocketAsset {
  const scene = options.root.getScene();
  if (scene.getEngine() !== engine) {
    throw new Error("VAT socket root belongs to a different Babylon.js engine.");
  }
  if (animationGroups.length === 0) {
    throw new Error("VAT socket baking requires at least one animation group.");
  }

  const nodes = resolveSockets(options.root, options.sockets);
  const clips: Record<string, { name: string; fps: number; frameCount: number; durationSeconds: number }> = {};
  const sockets: Record<string, Record<string, VatSocketTransformTrack>> = {};
  for (const key of Object.keys(nodes)) sockets[key] = {};

  for (const group of animationGroups) group.stop(true);
  for (const group of animationGroups) {
    const vatClip = options.clips?.[group.name];
    const from = vatClip?.fromFrame ?? Math.floor(group.from);
    const to = vatClip?.toFrame ?? Math.floor(group.to);
    const fps = vatClip?.fps ?? group.targetedAnimations[0]?.animation.framePerSecond ?? 30;
    if (!Number.isFinite(from) || !Number.isFinite(to) || to < from || !Number.isFinite(fps) || fps <= 0) {
      throw new Error(`Invalid VAT socket animation group '${group.name}'.`);
    }
    const frameCount = to - from + 1;
    clips[group.name] = { name: group.name, fps, frameCount, durationSeconds: frameCount / fps };

    const tracks = new Map<string, MutableTrack>();
    for (const key of Object.keys(nodes)) {
      tracks.set(key, {
        translations: new Float32Array(frameCount * 3),
        rotations: new Float32Array(frameCount * 4),
        scales: new Float32Array(frameCount * 3)
      });
    }

    group.start(false, 1, from, to);
    for (let frame = from; frame <= to; frame++) {
      group.goToFrame(frame);
      scene.render();
      const rootInverse = options.root.computeWorldMatrix(true).clone();
      rootInverse.invert();
      for (const [key, node] of Object.entries(nodes)) {
        const relative = node.computeWorldMatrix(true).multiply(rootInverse);
        writeDecomposed(relative, tracks.get(key)!, frame - from);
      }
    }
    group.stop(true);
    for (const [key, track] of tracks) sockets[key]![group.name] = track;
  }

  return {
    version: 1,
    space: "gltf-rh-model-world",
    // Relative-to-root sampling removes Babylon's glTF root conversion. Apply
    // the same RH-to-LH basis exposed by the Lite socket baker at runtime.
    basis: new Float32Array(RH_TO_LH_BASIS),
    clips,
    sockets
  };
}

const RH_TO_LH_BASIS = new Float32Array([
  -1, 0, 0, 0,
  0, 1, 0, 0,
  0, 0, 1, 0,
  0, 0, 0, 1
]);

interface MutableTrack extends VatSocketTransformTrack {
  readonly scales: Float32Array;
}

function resolveSockets(root: Node, requested: Readonly<Record<string, Node | string>>): Record<string, Node> {
  const hierarchy = [root, ...root.getDescendants(false)];
  const result: Record<string, Node> = {};
  for (const [key, value] of Object.entries(requested)) {
    const node = typeof value === "string" ? hierarchy.find((candidate) => candidate.name === value) : value;
    if (!node || !hierarchy.includes(node)) {
      throw new Error(`VAT socket '${key}' could not resolve node '${typeof value === "string" ? value : value.name}'.`);
    }
    result[key] = node;
  }
  if (Object.keys(result).length === 0) throw new Error("VAT socket baking requires at least one socket.");
  return result;
}

function writeDecomposed(matrix: Matrix, track: MutableTrack, frame: number): void {
  const scale = new Vector3();
  const rotation = new Quaternion();
  const translation = new Vector3();
  if (!matrix.decompose(scale, rotation, translation)) {
    throw new Error("Could not decompose a baked VAT socket transform.");
  }
  track.translations.set([translation.x, translation.y, translation.z], frame * 3);
  track.rotations.set([rotation.x, rotation.y, rotation.z, rotation.w], frame * 4);
  track.scales.set([scale.x, scale.y, scale.z], frame * 3);
}
