import {
  createLabel,
  createMarker,
  setAnnotationAnchor,
  updateMarker
} from "@litools/annotator";
import type { DemoContext } from "../shared/demo.js";

export function configureMarkers(ctx: DemoContext): void {
  const layer = ctx.layer!;
  ctx.panel.describe("Dots and rings share the projection pipeline. The moving amber target clamps to the camera viewport.");

  const left = ctx.addBox("Cooling intake", [-3.2, -0.55, 0], [0.08, 0.42, 0.58], 1.8);
  const center = ctx.addBox("Drive motor", [0, -0.3, 0], [0.12, 0.55, 0.4], 2.3);
  const right = ctx.addBox("Exhaust", [3.2, -0.55, 0], [0.5, 0.25, 0.2], 1.8);

  for (const [mesh, color, shape] of [
    [left, "#71d7ff", "ring"],
    [center, "#5bf0bd", "dot"],
    [right, "#ff8f76", "ring"]
  ] as const) {
    createMarker(layer, {
      anchor: { kind: "mesh", mesh, point: [0, 1.1, 0] },
      shape,
      size: shape === "ring" ? 20 : 14,
      style: { color, borderColor: color, borderWidth: 2 }
    });
  }

  const moving = createMarker(layer, {
    anchor: { kind: "world", position: [0, 2, 0] },
    shape: "ring",
    size: 24,
    clampToViewport: true,
    hideWhenOffscreen: false,
    style: { color: "#ffc766", borderColor: "#ffc766", borderWidth: 3 }
  });
  const movingLabel = createLabel(layer, {
    anchor: { kind: "world", position: [0, 2, 0] },
    text: "clamped target",
    screenOffset: [0, -24],
    clampToViewport: true,
    hideWhenOffscreen: false,
    style: {
      color: "#ffe1a2",
      backgroundColor: "#241b0de8",
      borderColor: "#ffc766",
      borderWidth: 1,
      borderRadius: 6,
      padding: 5,
      className: "annotation-label annotation-label--warning"
    }
  });

  let ring = true;
  ctx.panel.button("Toggle moving shape", () => {
    ring = !ring;
    updateMarker(moving, { shape: ring ? "ring" : "dot" });
    ctx.panel.status(ring ? "moving ring" : "moving dot");
  });

  let elapsed = 0;
  ctx.frame((deltaMs) => {
    elapsed += deltaMs / 1000;
    const position: [number, number, number] = [
      Math.sin(elapsed * 0.72) * 10,
      1.8 + Math.cos(elapsed * 1.1) * 2.8,
      Math.cos(elapsed * 0.72) * 2
    ];
    setAnnotationAnchor(moving, { kind: "world", position });
    setAnnotationAnchor(movingLabel, { kind: "world", position });
  });
}
