import { vi } from "vitest";
import { createVatAttachmentController } from "../src/vat-attachment-controller.js";

describe("Babylon.js VAT attachment controller", () => {
  it("composes character, socket, and grip transforms using stable IDs", () => {
    const characterId = 1 as never;
    const attachmentId = 10 as never;
    const writes: Float32Array[] = [];
    const controller = createVatAttachmentController({
      characters: {
        has: (id: number) => id === characterId,
        getVisible: () => true,
        getPlaybackSample: () => ({ clip: "Walk", timeSeconds: 0, offsetSeconds: 0, fps: 10, frame: 0, nextFrame: 1, alpha: 0 }),
        getMatrix: () => new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 100, 0, 0, 1])
      } as never,
      attachments: {
        has: (id: number) => id === attachmentId,
        batch: (callback: (writer: { setMatrix(id: number, matrix: Float32Array): void; setVisible(id: number, visible: boolean): void }) => void) => callback({
          setMatrix: (_id, matrix) => writes.push(matrix),
          setVisible: vi.fn()
        })
      } as never,
      socketAsset: {
        version: 1,
        space: "gltf-rh-model-world",
        basis: new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]),
        clips: { Walk: { name: "Walk", fps: 10, frameCount: 2, durationSeconds: 0.2 } },
        sockets: { sword: { Walk: {
          translations: new Float32Array([2, 3, 4, 0, 0, 0]),
          rotations: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1])
        } } }
      },
      socket: "sword"
    });

    expect(controller.bind(characterId, attachmentId)).toBe(true);
    expect(controller.update()).toBe(1);
    expect(Array.from(writes[0]!.slice(12, 15))).toEqual([102, 3, 4]);
  });
});
