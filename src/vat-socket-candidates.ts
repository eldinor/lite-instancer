import type { VatAttachmentPreset } from "./vat-attachment-preset.js";

/** The animation-track information needed to discover reliable VAT sockets. */
export interface VatSocketAnimationGroupLike {
  readonly targetedAnimations: readonly VatSocketAnimationTargetLike[];
}

/** A single animation target that may identify a glTF node. */
export interface VatSocketAnimationTargetLike {
  readonly nodeIndex?: number;
  readonly targetName?: string;
}

/** A node animated by every supplied clip and therefore safe for `clipScope: "all"`. */
export interface VatSocketCandidate {
  readonly nodeIndex: number;
  readonly nodeName: string;
}

/** Result of checking that a stored socket still identifies the same animated node. */
export type VatAttachmentPresetValidation =
  | { readonly valid: true; readonly socket: VatSocketCandidate }
  | { readonly valid: false; readonly reason: string };

/**
 * List nodes animated by every clip.
 *
 * A socket baked from this list remains available when the VAT character switches
 * among any of the supplied clips.
 */
export function getVatSocketCandidates(
  animationGroups: readonly VatSocketAnimationGroupLike[]
): VatSocketCandidate[] {
  if (animationGroups.length === 0) return [];
  const counts = new Map<number, { nodeName: string; clips: number }>();

  for (const animation of animationGroups) {
    const seenInClip = new Set<number>();
    for (const target of animation.targetedAnimations) {
      const nodeIndex = target.nodeIndex;
      if (nodeIndex === undefined || seenInClip.has(nodeIndex)) continue;
      seenInClip.add(nodeIndex);
      const item = counts.get(nodeIndex) ?? {
        nodeName: target.targetName ?? `node_${nodeIndex}`,
        clips: 0
      };
      item.clips++;
      counts.set(nodeIndex, item);
    }
  }

  return [...counts.entries()]
    .filter(([, item]) => item.clips === animationGroups.length)
    .map(([nodeIndex, item]) => ({ nodeIndex, nodeName: item.nodeName }))
    .sort((a, b) => a.nodeName.localeCompare(b.nodeName) || a.nodeIndex - b.nodeIndex);
}

/**
 * Verify that a configurator export still points at an all-clip animated node.
 *
 * The readable node name catches a changed GLB whose old numeric index now
 * identifies a different node.
 */
export function validateVatAttachmentPreset(
  preset: VatAttachmentPreset,
  animationGroups: readonly VatSocketAnimationGroupLike[]
): VatAttachmentPresetValidation {
  if (animationGroups.length === 0) {
    return { valid: false, reason: "Character has no animation groups to validate the socket." };
  }
  const socket = getVatSocketCandidates(animationGroups).find((candidate) => candidate.nodeIndex === preset.socket.nodeIndex);
  if (!socket) {
    return {
      valid: false,
      reason: `Socket #${preset.socket.nodeIndex} is not animated by every clip in this character.`
    };
  }
  if (socket.nodeName !== preset.socket.nodeName) {
    return {
      valid: false,
      reason: `Socket #${preset.socket.nodeIndex} is now named \"${socket.nodeName}\", not \"${preset.socket.nodeName}\".`
    };
  }
  return { valid: true, socket };
}
