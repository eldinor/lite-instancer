import { describe, expect, it } from "vitest";
import {
  computeOutlineAxisExtent,
  computeOutlineCenter,
  prepareOutlineGeometry,
  reverseTriangleWinding,
  smoothOutlineNormals,
  validateOutlineGeometry
} from "../src/outline-geometry.js";

describe("outline geometry", () => {
  it("clones geometry and reverses winding", () => {
    const positions = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]);
    const normals = new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1]);
    const indices = new Uint32Array([0, 1, 2]);
    const prepared = prepareOutlineGeometry({ positions, normals, indices }, false);

    expect(prepared.positions).not.toBe(positions);
    expect(prepared.normals).not.toBe(normals);
    expect(Array.from(prepared.indices)).toEqual([0, 2, 1]);
    prepared.positions[0] = 9;
    expect(positions[0]).toBe(0);
  });

  it("smooths coincident points across neighboring hash cells", () => {
    const epsilon = 0.01;
    const positions = new Float32Array([0.0099, 0, 0, 0.0101, 0, 0]);
    const normals = new Float32Array([1, 0, 0, 0, 1, 0]);
    smoothOutlineNormals(positions, normals, epsilon);
    expect(normals[0]).toBeCloseTo(Math.SQRT1_2);
    expect(normals[1]).toBeCloseTo(Math.SQRT1_2);
    expect(normals[3]).toBeCloseTo(Math.SQRT1_2);
    expect(normals[4]).toBeCloseTo(Math.SQRT1_2);
  });

  it("computes center and normalized axis extent", () => {
    const positions = new Float32Array([-2, -1, 4, 6, 3, 8]);
    expect(computeOutlineCenter(positions)).toEqual([2, 1, 6]);
    expect(computeOutlineAxisExtent(positions, "x")).toEqual({ min: -2, invLength: 0.125 });
  });

  it("rejects malformed geometry", () => {
    expect(() => validateOutlineGeometry({
      positions: new Float32Array([0, 0]),
      normals: new Float32Array([0, 1]),
      indices: new Uint32Array([0, 1, 2])
    })).toThrow(/positions/);
    expect(() => reverseTriangleWinding(new Uint32Array([0, 1]))).not.toThrow();
  });
});
