import type { Mat4 } from "@babylonjs/lite";
import { describe, expect, it } from "vitest";
import { projectAnnotationPosition } from "../../src/projection.js";

const identity = new Float32Array([
  1, 0, 0, 0,
  0, 1, 0, 0,
  0, 0, 1, 0,
  0, 0, 0, 1
]) as Mat4;

describe("annotation projection", () => {
  it("projects into a CSS-pixel camera viewport and reports depth and distance", () => {
    const result = projectAnnotationPosition({
      position: [0, 0, 0.5],
      viewProjection: identity,
      viewport: { left: 20, top: 10, width: 200, height: 100 },
      cameraPosition: [0, 0, -0.5]
    });

    expect(result.screenPosition).toEqual({ x: 120, y: 60 });
    expect(result.depth).toBe(0.5);
    expect(result.distance).toBe(1);
    expect(result.behindCamera).toBe(false);
    expect(result.offscreen).toBe(false);
  });

  it("reports offscreen and behind-camera points without discarding coordinates", () => {
    expect(projectAnnotationPosition({
      position: [2, 0, 0.5],
      viewProjection: identity,
      viewport: { left: 0, top: 0, width: 100, height: 100 },
      cameraPosition: [0, 0, 0]
    }).offscreen).toBe(true);

    const negativeWData = new Float32Array(identity);
    negativeWData[15] = -1;
    const negativeW = negativeWData as Mat4;
    const behind = projectAnnotationPosition({
      position: [0, 0, 0],
      viewProjection: negativeW,
      viewport: { left: 0, top: 0, width: 100, height: 100 },
      cameraPosition: [0, 0, 0]
    });
    expect(behind.behindCamera).toBe(true);
  });

  it("is independent of devicePixelRatio because viewport units are CSS pixels", () => {
    const original = Object.getOwnPropertyDescriptor(globalThis, "devicePixelRatio");
    Object.defineProperty(globalThis, "devicePixelRatio", { configurable: true, value: 3 });
    const result = projectAnnotationPosition({
      position: [0, 0, 0.5],
      viewProjection: identity,
      viewport: { left: 0, top: 0, width: 120, height: 80 },
      cameraPosition: [0, 0, 0]
    });
    expect(result.screenPosition).toEqual({ x: 60, y: 40 });
    if (original) Object.defineProperty(globalThis, "devicePixelRatio", original);
    else Reflect.deleteProperty(globalThis, "devicePixelRatio");
  });
});
