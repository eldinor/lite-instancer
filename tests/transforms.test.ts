import { describe, expect, it } from "vitest";
import { composeMat4, createIdentityMat4 } from "../src/transforms.js";

describe("transforms", () => {
  it("creates identity matrices", () => {
    expect(Array.from(createIdentityMat4())).toEqual([
      1, 0, 0, 0,
      0, 1, 0, 0,
      0, 0, 1, 0,
      0, 0, 0, 1
    ]);
  });

  it("composes translation and uniform scale", () => {
    const matrix = composeMat4({
      position: [1, 2, 3],
      scale: 2
    });
    expect(matrix[0]).toBe(2);
    expect(matrix[5]).toBe(2);
    expect(matrix[10]).toBe(2);
    expect(matrix[12]).toBe(1);
    expect(matrix[13]).toBe(2);
    expect(matrix[14]).toBe(3);
    expect(matrix[15]).toBe(1);
  });
});
