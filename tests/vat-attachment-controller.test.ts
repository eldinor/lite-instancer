import { describe, expect, it, vi } from "vitest";

vi.mock("@babylonjs/lite", () => ({
  mat4Compose: (tx: number, ty: number, tz: number) => {
    const matrix = new Float32Array(16);
    matrix[0] = 1;
    matrix[5] = 1;
    matrix[10] = 1;
    matrix[12] = tx;
    matrix[13] = ty;
    matrix[14] = tz;
    matrix[15] = 1;
    return matrix;
  },
  mat4Multiply: (a: Float32Array, b: Float32Array) => {
    const matrix = new Float32Array(16);
    matrix[0] = 1;
    matrix[5] = 1;
    matrix[10] = 1;
    matrix[12] = (a[12] ?? 0) + (b[12] ?? 0);
    matrix[13] = (a[13] ?? 0) + (b[13] ?? 0);
    matrix[14] = (a[14] ?? 0) + (b[14] ?? 0);
    matrix[15] = 1;
    return matrix;
  }
}));

describe("VAT attachment controller", () => {
  it("binds stable character and attachment IDs and writes their composed matrix", async () => {
    const { createVatAttachmentController } = await import("../src/vat-attachment-controller.js");
    const characterId = 1 as never;
    const attachmentId = 10 as never;
    const writes: Float32Array[] = [];
    const controller = createVatAttachmentController({
      characters: {
        has: (id: number) => id === characterId,
        getVisible: () => true,
        getPlaybackSample: () => ({ clip: "Walk", timeSeconds: 0, offsetSeconds: 0, fps: 10, frame: 0, nextFrame: 1, alpha: 0 }),
        getMatrix: () => {
          const matrix = new Float32Array(16);
          matrix[0] = matrix[5] = matrix[10] = matrix[15] = 1;
          matrix[12] = 100;
          return matrix;
        }
      } as never,
      attachments: {
        has: (id: number) => id === attachmentId,
        getVisible: () => true,
        batch: (callback: (writer: { setMatrix(id: number, matrix: Float32Array): void; setVisible(id: number, value: boolean): void }) => void) => callback({
          setMatrix: (_id, matrix) => writes.push(matrix),
          setVisible: vi.fn()
        })
      } as never,
      socketAsset: {
        version: 1,
        space: "gltf-rh-model-world",
        basis: new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]),
        clips: { Walk: { name: "Walk", fps: 10, frameCount: 2, durationSeconds: 0.2 } },
        sockets: { sword: { Walk: { translations: new Float32Array([2, 3, 4, 0, 0, 0]), rotations: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1]) } } }
      },
      socket: "sword"
    });

    expect(controller.bind(characterId, attachmentId)).toBe(true);
    expect(controller.update()).toBe(1);
    expect(writes).toHaveLength(1);
    expect(Array.from(writes[0]!.slice(12, 15))).toEqual([102, 3, 4]);
  });

  it("does not override an attachment hidden by its caller", async () => {
    const { createVatAttachmentController } = await import("../src/vat-attachment-controller.js");
    const characterId = 1 as never;
    const attachmentId = 10 as never;
    const setVisible = vi.fn();
    const controller = createVatAttachmentController({
      characters: {
        has: () => true,
        getVisible: () => true,
        getPlaybackSample: () => ({ clip: "Walk", timeSeconds: 0, offsetSeconds: 0, fps: 10, frame: 0, nextFrame: 1, alpha: 0 }),
        getMatrix: () => new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1])
      } as never,
      attachments: {
        has: () => true,
        getVisible: () => false,
        batch: (callback: (writer: { setMatrix(): void; setVisible(id: number, value: boolean): void }) => void) => callback({ setMatrix: vi.fn(), setVisible })
      } as never,
      socketAsset: {
        version: 1,
        space: "gltf-rh-model-world",
        basis: new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]),
        clips: { Walk: { name: "Walk", fps: 10, frameCount: 1, durationSeconds: 0.1 } },
        sockets: { sword: { Walk: { translations: new Float32Array([0, 0, 0]), rotations: new Float32Array([0, 0, 0, 1]) } } }
      },
      socket: "sword"
    });
    controller.bind(characterId, attachmentId);
    controller.update();
    expect(setVisible).not.toHaveBeenCalled();
  });
});
