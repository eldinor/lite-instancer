import { RegisterBufferAlign } from "@babylonjs/core/Buffers/buffer.align.pure.js";
import { RegisterRay } from "@babylonjs/core/Culling/ray.pure.js";
import { RegisterThinInstanceMesh } from "@babylonjs/core/Meshes/thinInstanceMesh.pure.js";

/**
 * Register the Babylon.js prototype extensions used by this package.
 *
 * Explicit calls are intentional: side-effect-only Babylon imports can be
 * removed by consumers because this package is declared side-effect free.
 */
export function registerThinInstanceSupport(): void {
  RegisterBufferAlign();
  RegisterThinInstanceMesh();
}

/** Register Babylon's ray helpers required by scene picking. */
export function registerPickingSupport(): void {
  registerThinInstanceSupport();
  RegisterRay();
}
