import { mat4Compose, mat4Multiply, type EngineContext, type Mat4, type SceneNode } from "@babylonjs/lite";
import { createHierarchyInstanceSet, type HierarchyInstanceSet } from "./hierarchy-instance-set.js";
import type { HierarchyInstanceSetOptions, InstanceId, InstanceTransformInput } from "./types.js";
import { createVatAttachmentController, type VatAttachmentController } from "./vat-attachment-controller.js";
import { quaternionFromEulerDegrees, type VatAttachmentPreset } from "./vat-attachment-preset.js";
import type { VatPlaybackSource } from "./vat-instance-set.js";
import type { VatSocketAsset } from "./vat-socket-asset.js";

/** Options for a preset-backed attachment hierarchy and socket controller. */
export interface VatAttachmentBindingFactoryOptions<TAttachment = unknown> {
  readonly engine: EngineContext;
  readonly character: VatPlaybackSource;
  readonly attachmentRoot: SceneNode;
  readonly socketAsset: VatSocketAsset;
  readonly preset: VatAttachmentPreset;
  readonly instanceOptions?: HierarchyInstanceSetOptions;
  readonly hideWithCharacter?: boolean;
}

/**
 * Rigid hierarchy instances bound to a VAT socket with the authored GLB root
 * matrix and configurator grip applied automatically.
 */
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

/**
 * Create a hierarchy instance set and bind it to the socket named by a
 * configurator preset. The supplied root remains the source hierarchy; add it
 * to the scene before rendering, as with `createHierarchyInstanceSet()`.
 */
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
  const gripOffset = createPresetGripOffset(options.preset, options.attachmentRoot.worldMatrix);

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

/** Compose a configurator grip and the authored attachment root transform. */
export function createPresetGripOffset(preset: VatAttachmentPreset, attachmentRootMatrix: Mat4): Mat4 {
  const [pitch, yaw, roll] = preset.grip.rotationEulerDegrees;
  const [qx, qy, qz, qw] = quaternionFromEulerDegrees(pitch, yaw, roll);
  const [x, y, z] = preset.grip.translation;
  const [sx, sy, sz] = preset.grip.scale;
  const userGrip = mat4Compose(x, y, z, qx, qy, qz, qw, sx, sy, sz);
  return mat4Multiply(userGrip, attachmentRootMatrix);
}

function assertSocketTracks(socketAsset: VatSocketAsset, preset: VatAttachmentPreset): void {
  const tracks = socketAsset.sockets[preset.socket.key];
  if (!tracks) {
    throw new Error(`VAT socket asset does not contain socket \"${preset.socket.key}\".`);
  }
  for (const clipName of Object.keys(socketAsset.clips)) {
    if (!tracks[clipName]) {
      throw new Error(`VAT socket \"${preset.socket.key}\" is missing clip \"${clipName}\".`);
    }
  }
}
