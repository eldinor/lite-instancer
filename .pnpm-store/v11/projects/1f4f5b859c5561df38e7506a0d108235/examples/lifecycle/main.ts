import {
  createLabel,
  createMarker,
  disposeAnnotation,
  type LabelHandle,
  type MarkerHandle
} from "@litools/annotator";
import type { DemoContext } from "../shared/demo.js";

export function configureLifecycle(ctx: DemoContext): void {
  ctx.panel.describe("Annotation and layer disposal are idempotent. Recreating a layer leaves no stale DOM roots.");
  const left = ctx.addBox("Owned label", [-2.2, -0.35, 0], [0.12, 0.58, 0.45], 2.2);
  const right = ctx.addBox("Owned marker", [2.2, -0.35, 0], [0.25, 0.4, 0.7], 2.2);
  let label: LabelHandle | undefined;
  let marker: MarkerHandle | undefined;

  function populate(): void {
    const layer = ctx.layer ?? ctx.recreateLayer("raf");
    label = createLabel(layer, {
      anchor: { kind: "mesh", mesh: left, point: [0, 1.25, 0] },
      text: "individually disposable",
      screenOffset: [0, -8],
      style: {
        color: "#f3fffb",
        backgroundColor: "#0a1715ec",
        borderColor: "#5bf0bd",
        borderWidth: 1,
        borderRadius: 7,
        padding: 7,
        className: "annotation-label"
      }
    });
    marker = createMarker(layer, {
      anchor: { kind: "mesh", mesh: right, point: [0, 1.25, 0] },
      shape: "ring",
      size: 24,
      style: { color: "#71d7ff", borderColor: "#71d7ff", borderWidth: 3 }
    });
    ctx.panel.status("layer populated");
  }

  populate();
  ctx.panel.button("Dispose label", () => {
    if (!label) return;
    disposeAnnotation(label);
    disposeAnnotation(label);
    label = undefined;
    ctx.panel.status("label disposed twice safely");
  });
  ctx.panel.button("Dispose marker", () => {
    if (!marker) return;
    disposeAnnotation(marker);
    marker = undefined;
    ctx.panel.status("marker disposed");
  });
  ctx.panel.button("Dispose complete layer", () => {
    ctx.disposeLayer();
    label = undefined;
    marker = undefined;
    ctx.panel.status("layer and owned DOM removed");
  });
  ctx.panel.button("Recreate layer + items", () => {
    ctx.disposeLayer();
    ctx.recreateLayer("raf");
    populate();
    ctx.panel.status("fresh layer created");
  });

  ctx.frame((deltaMs) => {
    left.rotation.y += deltaMs * 0.00012;
    right.rotation.y -= deltaMs * 0.0001;
  });
}
