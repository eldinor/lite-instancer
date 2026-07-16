import { describe, expect, it } from "vitest";
import { createVatSocketTransform, sampleVatSocket, type VatSocketAsset } from "../src/vat-socket-asset.js";

const asset: VatSocketAsset = {
  version: 1,
  space: "gltf-rh-model-world",
  basis: new Float32Array([-1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]),
  clips: {
    Walk: { name: "Walk", fps: 10, frameCount: 2, durationSeconds: 0.2 }
  },
  sockets: {
    hand: {
      Walk: {
        translations: new Float32Array([0, 0, 0, 10, 20, 30]),
        rotations: new Float32Array([0, 0, 0, 1, 0, 0, 1, 0]),
        scales: new Float32Array([1, 1, 1, 2, 3, 4])
      }
    }
  }
};

describe("VAT socket sampling", () => {
  it("uses the discrete VAT frame by default", () => {
    const result = sampleVatSocket(
      asset,
      { clip: "Walk", timeSeconds: 0, offsetSeconds: 0, fps: 10, frame: 1, nextFrame: 0, alpha: 0.5 },
      "hand"
    );

    expect(Array.from(result?.translation ?? [])).toEqual([10, 20, 30]);
    expect(Array.from(result?.scale ?? [])).toEqual([2, 3, 4]);
  });

  it("can interpolate TRS tracks into caller-owned output", () => {
    const out = createVatSocketTransform();
    const result = sampleVatSocket(
      asset,
      { clip: "Walk", timeSeconds: 0, offsetSeconds: 0, fps: 10, frame: 0, nextFrame: 1, alpha: 0.5 },
      "hand",
      out,
      { interpolate: true }
    );

    expect(result).toBe(out);
    expect(Array.from(out.translation)).toEqual([5, 10, 15]);
    expect(Array.from(out.scale)).toEqual([1.5, 2, 2.5]);
    expect(out.rotation[2]).toBeCloseTo(Math.SQRT1_2, 5);
    expect(out.rotation[3]).toBeCloseTo(Math.SQRT1_2, 5);
  });
});
