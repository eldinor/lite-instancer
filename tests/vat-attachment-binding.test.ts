import { describe, expect, it, vi } from "vitest";

vi.mock("@babylonjs/lite", () => ({
  mat4Compose: (x: number, y: number, z: number, _qx: number, _qy: number, _qz: number, _qw: number, sx: number, sy: number, sz: number) => {
    const matrix = new Float32Array(16);
    matrix[0] = sx;
    matrix[5] = sy;
    matrix[10] = sz;
    matrix[12] = x;
    matrix[13] = y;
    matrix[14] = z;
    matrix[15] = 1;
    return matrix;
  },
  mat4Multiply: (a: Float32Array, b: Float32Array) => {
    const matrix = new Float32Array(a);
    matrix[12] = (matrix[12] ?? 0) + (b[12] ?? 0);
    matrix[13] = (matrix[13] ?? 0) + (b[13] ?? 0);
    matrix[14] = (matrix[14] ?? 0) + (b[14] ?? 0);
    return matrix;
  }
}));

describe("preset VAT attachment binding", () => {
  it("includes the authored attachment-root transform after the configurable grip", async () => {
    const { createPresetGripOffset } = await import("../src/vat-attachment-binding.js");
    const root = new Float32Array(16);
    root[0] = root[5] = root[10] = root[15] = 1;
    root[12] = 10;
    root[13] = 20;
    root[14] = 30;
    const matrix = createPresetGripOffset({
      version: 1,
      character: { kind: "url", url: "/hero.glb" },
      attachment: { kind: "url", url: "/sword.glb" },
      socket: { key: "weapon", nodeIndex: 7, nodeName: "RightHand" },
      clipScope: "all",
      grip: { translation: [1, 2, 3], rotationEulerDegrees: [0, 0, 0], scale: [2, 3, 4] }
    }, root as never);

    const values = matrix as Float32Array;
    expect(values[0]).toBe(2);
    expect(values[5]).toBe(3);
    expect(values[10]).toBe(4);
    expect(values[12]).toBe(11);
    expect(values[13]).toBe(22);
    expect(values[14]).toBe(33);
  });
});
