import type { Camera, Mesh, SceneContext } from "@babylonjs/lite";
import {
  createAnnotationLayer,
  createLabel,
  disposeAnnotationLayer,
  updateAnnotationLayer
} from "@litools/annotator";
import { createHtmlAnnotationBackend } from "@litools/annotator/html";

export function attachMeshLabel(
  scene: SceneContext,
  camera: Camera,
  canvas: HTMLCanvasElement,
  overlayContainer: HTMLElement,
  mesh: Mesh
): () => void {
  const layer = createAnnotationLayer({
    scene,
    camera,
    canvas,
    backend: createHtmlAnnotationBackend({ container: overlayContainer })
  });
  createLabel(layer, {
    anchor: { kind: "mesh", mesh, preset: "top" },
    text: "Pump A-12",
    screenOffset: [0, -8],
    clampToViewport: true,
    style: {
      color: "#ffffff",
      backgroundColor: "#18202b",
      padding: 6,
      borderRadius: 4
    }
  });

  // Call this from the application's render/update loop.
  updateAnnotationLayer(layer);
  return () => disposeAnnotationLayer(layer);
}
