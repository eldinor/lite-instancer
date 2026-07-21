import {
  computeLiteVatAssetIntegrity,
  decodeLiteVatAsset,
  encodeLiteVatAsset,
  validateLiteVatAsset,
  type LiteVatAsset
} from "../src/vat-asset.js";
import { DEFAULT_VAT_BAKE_LIMITS, packLiteVatAsset } from "../src/vat-preprocess.js";

function fixture(): LiteVatAsset {
  const frameData = new Float32Array(32);
  frameData[0] = 1;
  frameData[17] = 2;
  return {
    version: 1,
    encoding: "lite-matrix-rgba32float",
    basis: "gltf-rh-model-world",
    boneCount: 1,
    frameCount: 2,
    texture: { width: 4, height: 2, format: "rgba32float" },
    clips: { Idle: { fromRow: 0, frameCount: 2, fps: 30 } },
    frameData,
    bounds: { model: { min: [-1, 0, -1], max: [1, 2, 1] } },
    integrity: computeLiteVatAssetIntegrity(frameData)
  };
}

describe("LiteVatAsset", () => {
  it("round trips deterministic metadata and binary frame data", () => {
    const source = fixture();
    const encoded = encodeLiteVatAsset(source);
    const decoded = decodeLiteVatAsset(encoded.manifest, encoded.payload);
    expect(decoded).toMatchObject({ version: 1, encoding: source.encoding, clips: source.clips, bounds: source.bounds });
    expect(Array.from(decoded.frameData)).toEqual(Array.from(source.frameData));
    expect(encodeLiteVatAsset(decoded).manifest).toBe(encoded.manifest);
  });

  it("rejects corrupt payloads and clips outside the atlas", () => {
    const corrupt = fixture();
    corrupt.frameData[0] = 99;
    expect(() => validateLiteVatAsset(corrupt)).toThrow(/integrity/i);
    const source = fixture();
    expect(() => validateLiteVatAsset({ ...source, clips: { Bad: { fromRow: 1, frameCount: 2, fps: 30 } } })).toThrow(/exceeds/i);
  });

  it("enforces preprocessing limits before building the asset", () => {
    const source = fixture();
    expect(() => packLiteVatAsset(source, { ...DEFAULT_VAT_BAKE_LIMITS, maxBones: 0.5 })).toThrow(/bones limit/i);
  });
});
