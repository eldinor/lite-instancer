import { describe, expect, it } from "vitest";
import {
  composeMat4,
  createIdentityMat4,
  getMat4Position,
  translateMat4,
  withMat4Position,
  withMat4Scale
} from "../src/transforms.js";

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

  it("reads, writes, translates, and rescales matrix helpers", () => {
    const matrix = composeMat4({
      position: [1, 2, 3],
      scale: [2, 3, 4]
    });

    expect(Array.from(getMat4Position(matrix))).toEqual([1, 2, 3]);

    const moved = withMat4Position(matrix, [4, 5, 6]);
    expect(Array.from(getMat4Position(moved))).toEqual([4, 5, 6]);

    const translated = translateMat4(moved, [1, -2, 3]);
    expect(Array.from(getMat4Position(translated))).toEqual([5, 3, 9]);

    const scaled = withMat4Scale(translated, [5, 6, 7]);
    expect(scaled[0]).toBe(5);
    expect(scaled[5]).toBe(6);
    expect(scaled[10]).toBe(7);
    expect(Array.from(getMat4Position(scaled))).toEqual([5, 3, 9]);
  });
});
