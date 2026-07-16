import {
  goToFrame,
  mat4Decompose,
  mat4Multiply,
  type AnimationGroup,
  type EngineContext,
  type Mat4,
  type VatClip
} from "@babylonjs/lite";
import type { VatSocketAsset, VatSocketClip, VatSocketTransformTrack } from "./vat-socket-asset.js";

/** Select sockets by animated node name or glTF node index. */
export interface VatSocketBakeOptions {
  readonly sockets: Readonly<Record<string, string | number>>;
  /** VAT clip rows to match. Defaults to all supplied animation groups. */
  readonly clips?: Readonly<Record<string, VatClip>>;
}

interface AnimationControllerDebug {
  _debugWorldMat: Float32Array;
}

/**
 * Bake model-space socket TRS tracks for VAT animation groups.
 *
 * Temporary Lite adapter: it reads the private `_ctrl._debugWorldMat` array.
 * Replace this implementation when Babylon Lite exposes public VAT-frame node
 * transform capture. The rest of the socket API deliberately does not expose
 * this private dependency.
 */
export function bakeVatSocketAsset(
  engine: EngineContext,
  animationGroups: readonly AnimationGroup[],
  options: VatSocketBakeOptions
): VatSocketAsset {
  const clips: Record<string, VatSocketClip> = {};
  const sockets: Record<string, Record<string, VatSocketTransformTrack>> = {};
  const socketEntries = Object.entries(options.sockets);
  if (socketEntries.length === 0) {
    throw new Error("bakeVatSocketAsset requires at least one socket");
  }

  for (const group of animationGroups) {
    const vatClip = options.clips?.[group.name];
    const fps = vatClip?.fps ?? group.frameRate ?? 60;
    const frameCount = vatClip?.frameCount ?? Math.max(1, Math.round(group.duration * fps) + 1);
    clips[group.name] = {
      name: group.name,
      fps,
      frameCount,
      durationSeconds: frameCount / fps
    };

    const nodeIndices = socketEntries.map(([socket, target]) => ({ socket, nodeIndex: findNodeIndex(group, target) }));
    const tracks = new Map<string, VatSocketTransformTrack>();
    for (const { socket } of nodeIndices) {
      tracks.set(socket, {
        translations: new Float32Array(frameCount * 3),
        rotations: new Float32Array(frameCount * 4),
        scales: new Float32Array(frameCount * 3)
      });
    }

    for (let frame = 0; frame < frameCount; frame++) {
      goToFrame(group, frame, engine);
      const controller = (group as unknown as { _ctrl?: AnimationControllerDebug })._ctrl;
      if (!controller?._debugWorldMat) {
        throw new Error(`Animation group ${group.name} does not expose a controller world-matrix buffer`);
      }
      for (const { socket, nodeIndex } of nodeIndices) {
        const track = tracks.get(socket)!;
        const matrix = controller._debugWorldMat.subarray(nodeIndex * 16, nodeIndex * 16 + 16) as Mat4;
        // Lite's glTF controller prepends an RH-to-LH reflection. Strip that
        // reflection before TRS decomposition, then expose it as asset.basis so
        // the attachment controller can restore it after sampling.
        const { translation, rotation, scale } = mat4Decompose(mat4Multiply(RH_TO_LH_BASIS, matrix));
        const t = frame * 3;
        const r = frame * 4;
        track.translations[t] = translation.x;
        track.translations[t + 1] = translation.y;
        track.translations[t + 2] = translation.z;
        track.rotations[r] = rotation.x;
        track.rotations[r + 1] = rotation.y;
        track.rotations[r + 2] = rotation.z;
        track.rotations[r + 3] = rotation.w;
        track.scales![t] = scale.x;
        track.scales![t + 1] = scale.y;
        track.scales![t + 2] = scale.z;
      }
    }

    for (const [socket, track] of tracks) {
      (sockets[socket] ??= {})[group.name] = track;
    }
  }

  return { version: 1, space: "gltf-rh-model-world", basis: new Float32Array(RH_TO_LH_BASIS), clips, sockets };
}

const RH_TO_LH_BASIS = new Float32Array([
  -1, 0, 0, 0,
  0, 1, 0, 0,
  0, 0, 1, 0,
  0, 0, 0, 1
]) as Mat4;

function findNodeIndex(group: AnimationGroup, target: string | number): number {
  if (typeof target === "number") {
    return target;
  }
  const nodeIndex = group.targetedAnimations.find((animation) => animation.targetName === target)?.nodeIndex;
  if (nodeIndex === undefined) {
    throw new Error(`Animation group ${group.name} does not target socket node ${target}`);
  }
  return nodeIndex;
}
