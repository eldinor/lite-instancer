import { NullEngine } from "@babylonjs/core/Engines/nullEngine.js";
import { inspectInstancerCapabilities } from "../src/capabilities.js";

describe("Babylon.js instancer capabilities", () => {
  it("reports native partial uploads and the Babylon VAT runtime", () => {
    const engine = new NullEngine();
    const capabilities = inspectInstancerCapabilities(engine);
    expect(capabilities).toMatchObject({
      runtime: "babylonjs",
      renderingBackend: "webgl",
      vatAssetCodecs: true,
      vatAssetRuntime: true,
      partialVatUploads: true,
      dynamicDrawCount: true
    });
    expect(capabilities.supportedVatEncodings).toEqual(["babylon-matrix-vat"]);
    expect(capabilities.float16Shader).toBe(engine.getCaps().textureHalfFloat);
    engine.dispose();
  });

  it("reports unknown GPU details when no engine is supplied", () => {
    const capabilities = inspectInstancerCapabilities();
    expect(capabilities.renderingBackend).toBe("unknown");
    expect(capabilities.float16Shader).toBe(false);
    expect(capabilities.warnings.some((warning) => warning.includes("No Babylon.js engine"))).toBe(true);
  });
});
