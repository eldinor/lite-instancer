import type { AbstractEngine } from "@babylonjs/core/Engines/abstractEngine.js";

export interface InstancerCapabilities {
  readonly runtime: "babylonjs";
  readonly renderingBackend: "webgpu" | "webgl" | "unknown";
  readonly worker: boolean;
  readonly float16Shader: boolean;
  readonly vatAssetCodecs: true;
  readonly vatAssetRuntime: true;
  readonly partialVatUploads: true;
  readonly dynamicDrawCount: true;
  readonly supportedVatEncodings: readonly ["babylon-matrix-vat"];
  readonly warnings: readonly string[];
}

/** Report public Babylon.js capabilities and the instancer paths selected from them. */
export function inspectInstancerCapabilities(engine?: AbstractEngine): InstancerCapabilities {
  const worker = typeof Worker !== "undefined";
  const renderingBackend = detectRenderingBackend(engine);
  const caps = engine?.getCaps();
  const warnings = [
    ...(!engine ? ["No Babylon.js engine was supplied; GPU capabilities and rendering backend are unknown."] : []),
    ...(caps && !caps.instancedArrays ? ["The Babylon.js engine does not report hardware instancing support."] : []),
    ...(caps && !caps.textureFloat ? ["The Babylon.js engine does not report float texture support required by matrix VAT assets."] : []),
    ...(!worker ? ["Web Workers are unavailable in this environment."] : [])
  ];
  return {
    runtime: "babylonjs",
    renderingBackend,
    worker,
    float16Shader: caps?.textureHalfFloat === true,
    vatAssetCodecs: true,
    vatAssetRuntime: true,
    partialVatUploads: true,
    dynamicDrawCount: true,
    supportedVatEncodings: ["babylon-matrix-vat"],
    warnings
  };
}

function detectRenderingBackend(engine: AbstractEngine | undefined): InstancerCapabilities["renderingBackend"] {
  if (!engine) return "unknown";
  const className = engine.getClassName().toLowerCase();
  if (className.includes("webgpu")) return "webgpu";
  if (className === "engine" || className.includes("thinengine")) return "webgl";
  return "unknown";
}
