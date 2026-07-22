import { inspectInstancerCapabilities } from "../src/capabilities.js";

describe("instancer capabilities", () => {
  it("reports full VAT uploads and an explicit asset-runtime boundary", () => {
    const capabilities = inspectInstancerCapabilities();
    expect(capabilities.partialVatUploads).toBe(false);
    expect(capabilities.dynamicDrawCount).toBe(true);
    expect(capabilities.vatAssetCodecs).toBe(true);
    expect(capabilities.supportedVatEncodings).toEqual(["lite-matrix-rgba32float"]);
    expect(capabilities.warnings.some((warning) => warning.includes("full"))).toBe(true);
  });
});
