import type { EngineContext } from "@babylonjs/lite";

export interface InstancerCapabilities {
  readonly runtime: "babylon-lite";
  readonly renderingBackend: "webgpu" | "unknown";
  readonly worker: boolean;
  readonly float16Shader: boolean;
  readonly vatAssetCodecs: true;
  readonly vatAssetRuntime: boolean;
  readonly partialVatUploads: false;
  readonly dynamicDrawCount: true;
  readonly supportedVatEncodings: readonly ["lite-matrix-rgba32float"];
  readonly warnings: readonly string[];
}

export interface InstancerCapabilityOptions {
  /** True when the application supplies a public LiteVatAssetRuntime implementation. */
  readonly vatAssetRuntime?: boolean;
}

/** Report selected and unavailable paths without inspecting Babylon Lite private fields. */
export function inspectInstancerCapabilities(
  _engine?: EngineContext,
  options: InstancerCapabilityOptions = {}
): InstancerCapabilities {
  const worker = typeof Worker !== "undefined";
  const float16Shader = typeof navigator !== "undefined" && "gpu" in navigator;
  const vatAssetRuntime = options.vatAssetRuntime === true;
  const warnings = [
    "Babylon Lite currently requires full per-instance VAT uploads.",
    ...(!vatAssetRuntime ? ["Portable VAT codecs are available, but loading requires a public Babylon Lite VAT texture importer."] : []),
    ...(!worker ? ["Web Workers are unavailable in this environment."] : [])
  ];
  return {
    runtime: "babylon-lite",
    renderingBackend: typeof navigator !== "undefined" && "gpu" in navigator ? "webgpu" : "unknown",
    worker,
    float16Shader,
    vatAssetCodecs: true,
    vatAssetRuntime,
    partialVatUploads: false,
    dynamicDrawCount: true,
    supportedVatEncodings: ["lite-matrix-rgba32float"],
    warnings
  };
}
