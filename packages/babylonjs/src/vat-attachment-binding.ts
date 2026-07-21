import type { AbstractEngine } from "@babylonjs/core/Engines/abstractEngine.js";
import type { Node } from "@babylonjs/core/node.js";
import { createHierarchyInstanceSet, type HierarchyInstanceSet } from "./hierarchy-instance-set.js";
import { composeMat4 } from "./transforms.js";
import type { HierarchyInstanceSetOptions, InstanceId, InstanceTransformInput, Mat4 } from "./types.js";
import { createVatAttachmentController, type VatAttachmentController } from "./vat-attachment-controller.js";
import { quaternionFromEulerDegrees, type VatAttachmentPreset } from "./vat-attachment-preset.js";
import type { VatPlaybackSource } from "./vat-instance-set.js";
import type { VatSocketAsset } from "./vat-socket-asset.js";

export interface VatAttachmentBindingFactoryOptions<TAttachment = unknown> {
  readonly engine: AbstractEngine;
  readonly character: VatPlaybackSource;
  readonly attachmentRoot: Node;
  readonly socketAsset: VatSocketAsset;
  readonly preset: VatAttachmentPreset;
  readonly instanceOptions?: HierarchyInstanceSetOptions;
  readonly hideWithCharacter?: boolean;
}

export interface VatAttachmentBinding<TAttachment = unknown> {
  readonly attachments: HierarchyInstanceSet<TAttachment>;
  readonly controller: VatAttachmentController;
  readonly gripOffset: Mat4;
  create(transform?: InstanceTransformInput, metadata?: TAttachment): InstanceId;
  bind(characterId: InstanceId, attachmentId: InstanceId): boolean;
  unbind(characterId: InstanceId): boolean;
  update(): number;
  clear(): void;
  dispose(): void;
}

/** Create a rigid hierarchy set and bind it to the socket named by a portable preset. */
export function createVatAttachmentBinding<TAttachment = unknown>(
  options: VatAttachmentBindingFactoryOptions<TAttachment>
): VatAttachmentBinding<TAttachment> {
  assertSocketTracks(options.socketAsset, options.preset);
  const attachments = createHierarchyInstanceSet<TAttachment>(options.attachmentRoot, {
    ...(options.instanceOptions ?? {}),
    engine: options.engine
  });
  const controller = createVatAttachmentController({
    characters: options.character,
    attachments,
    socketAsset: options.socketAsset,
    socket: options.preset.socket.key,
    ...(options.hideWithCharacter === undefined ? {} : { hideWithCharacter: options.hideWithCharacter })
  });
  const gripOffset = createPresetGripOffset(options.preset);
  return {
    attachments,
    controller,
    gripOffset,
    create: (transform, metadata) => attachments.create(transform, metadata),
    bind: (characterId, attachmentId) => controller.bind(characterId, attachmentId, { gripOffset }),
    unbind: (characterId) => controller.unbind(characterId),
    update: () => controller.update(),
    clear() {
      controller.clear();
      attachments.clear();
    },
    dispose() {
      controller.clear();
      attachments.dispose();
    }
  };
}

/** Compose the human-editable preset grip; authored GLB transforms stay on the source hierarchy. */
export function createPresetGripOffset(preset: VatAttachmentPreset): Mat4 {
  const [pitch, yaw, roll] = preset.grip.rotationEulerDegrees;
  const [x, y, z] = preset.grip.translation;
  const [sx, sy, sz] = preset.grip.scale;
  return composeMat4({
    position: [x, y, z],
    rotationQuaternion: quaternionFromEulerDegrees(pitch, yaw, roll),
    scale: [sx, sy, sz]
  });
}

function assertSocketTracks(socketAsset: VatSocketAsset, preset: VatAttachmentPreset): void {
  const tracks = socketAsset.sockets[preset.socket.key];
  if (!tracks) throw new Error(`VAT socket asset does not contain socket "${preset.socket.key}".`);
  for (const clipName of Object.keys(socketAsset.clips)) {
    if (!tracks[clipName]) throw new Error(`VAT socket "${preset.socket.key}" is missing clip "${clipName}".`);
  }
}
