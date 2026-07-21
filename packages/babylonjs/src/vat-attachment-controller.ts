import { composeMat4, multiplyMat4 } from "./transforms.js";
import type { BaseInstanceSet, InstanceId, Mat4 } from "./types.js";
import { createVatSocketTransform, sampleVatSocket, type VatSocketAsset } from "./vat-socket-asset.js";
import type { VatPlaybackSource } from "./vat-instance-set.js";

export interface VatAttachmentBindingOptions {
  /** Transform from the baked socket to the attachment's local grip. */
  gripOffset?: Mat4;
}

export interface VatAttachmentControllerOptions<TCharacter = unknown, TAttachment = unknown> {
  /** VAT playback source for the animated character, including coordinated multi-mesh sets. */
  readonly characters: VatPlaybackSource;
  /** A single-mesh or hierarchy instance set for the rigid attachment asset. */
  readonly attachments: BaseInstanceSet<TAttachment>;
  readonly socketAsset: VatSocketAsset;
  readonly socket: string;
  /** Hide an attachment while its character is hidden. Defaults to true. */
  readonly hideWithCharacter?: boolean;
}

export interface VatAttachmentController {
  /** Bind an attachment ID to a character ID, replacing any existing character binding. */
  bind(characterId: InstanceId, attachmentId: InstanceId, options?: VatAttachmentBindingOptions): boolean;
  /** Remove a character's attachment binding. */
  unbind(characterId: InstanceId): boolean;
  /** Return the attachment ID currently bound to a character. */
  getAttachment(characterId: InstanceId): InstanceId | undefined;
  /** Resample sockets and update all valid attachment transforms. */
  update(): number;
  /** Remove every attachment binding. */
  clear(): void;
}

interface Binding {
  attachmentId: InstanceId;
  gripOffset: Mat4;
}

/**
 * Synchronize rigid thin-instance attachments to VAT socket tracks.
 * Bindings use stable IDs, so instance slot swaps are safe.
 */
export function createVatAttachmentController<TCharacter = unknown, TAttachment = unknown>(
  options: VatAttachmentControllerOptions<TCharacter, TAttachment>
): VatAttachmentController {
  const bindings = new Map<InstanceId, Binding>();
  const hiddenByCharacter = new Set<InstanceId>();
  const hideWithCharacter = options.hideWithCharacter ?? true;
  const pose = createVatSocketTransform();
  const playback = { clip: "", timeSeconds: 0, offsetSeconds: 0, fps: 0, frame: 0, nextFrame: 0, alpha: 0 };
  const characterMatrix = new Float32Array(16) as Mat4;

  return {
    bind(characterId, attachmentId, bindingOptions = {}) {
      if (!options.characters.has(characterId) || !options.attachments.has(attachmentId)) {
        return false;
      }
      bindings.set(characterId, {
        attachmentId,
        gripOffset: copyMatrix(bindingOptions.gripOffset)
      });
      return true;
    },
    unbind(characterId) {
      const attachmentId = bindings.get(characterId)?.attachmentId;
      if (attachmentId !== undefined) {
        hiddenByCharacter.delete(attachmentId);
      }
      return bindings.delete(characterId);
    },
    getAttachment(characterId) {
      return bindings.get(characterId)?.attachmentId;
    },
    update() {
      let updated = 0;
      options.attachments.batch((writer) => {
        for (const [characterId, binding] of bindings) {
          if (!options.characters.has(characterId) || !options.attachments.has(binding.attachmentId)) {
            hiddenByCharacter.delete(binding.attachmentId);
            bindings.delete(characterId);
            continue;
          }
          const visible = options.characters.getVisible(characterId);
          if (!visible && hideWithCharacter) {
            writer.setVisible(binding.attachmentId, false);
            hiddenByCharacter.add(binding.attachmentId);
            continue;
          }
          const sample = options.characters.getPlaybackSample(characterId, playback);
          const socket = sample && sampleVatSocket(options.socketAsset, sample, options.socket, pose);
          if (!socket) {
            continue;
          }
          const socketMatrix = composeMat4({
            position: socket.translation,
            rotationQuaternion: socket.rotation,
            scale: socket.scale
          });
          const socketWithGrip = multiplyMat4(multiplyMat4(options.socketAsset.basis as Mat4, socketMatrix), binding.gripOffset);
          const world = multiplyMat4(options.characters.getMatrix(characterId, characterMatrix), socketWithGrip);
          writer.setMatrix(binding.attachmentId, world);
          if (hideWithCharacter && hiddenByCharacter.delete(binding.attachmentId)) {
            writer.setVisible(binding.attachmentId, true);
          }
          updated++;
        }
      });
      return updated;
    },
    clear() {
      bindings.clear();
      hiddenByCharacter.clear();
    }
  };
}

function copyMatrix(matrix: Mat4 | undefined): Mat4 {
  if (matrix) {
    return new Float32Array(matrix) as Mat4;
  }
  const identity = new Float32Array(16);
  identity[0] = 1;
  identity[5] = 1;
  identity[10] = 1;
  identity[15] = 1;
  return identity as Mat4;
}
