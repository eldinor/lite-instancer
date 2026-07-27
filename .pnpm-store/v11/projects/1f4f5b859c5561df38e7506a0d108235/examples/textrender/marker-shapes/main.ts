import { createLabel, createMarker, type MarkerShape } from "@litools/annotator";
import type { TextDemoContext } from "../shared.js";

const shapes: readonly MarkerShape[] = [
  "dot",
  "ring",
  "square",
  "diamond",
  "triangle",
  "cross",
  "pin",
  "demo/star"
];

export function configureGpuMarkerShapes(context: TextDemoContext): void {
  context.panel.describe("Seven built-in one-sprite shapes plus one application-registered shape, all in a single GPU marker draw call.");
  for (const [index, shape] of shapes.entries()) {
    const column = index % 4;
    const row = Math.floor(index / 4);
    const position = [-4.5 + column * 3, 1.55 - row * 3, 0] as const;
    const mesh = context.addBox(shape, position, [0.08, 0.2 + row * 0.06, 0.17], 1.25);
    const anchor = { kind: "mesh" as const, mesh, point: [0, 0.85, 0] as const, space: "local" as const };
    createMarker(context.layer, {
      anchor,
      shape,
      size: shape === "pin" ? 38 : 34,
      style: shape === "ring"
        ? { color: "#72e6ff", borderWidth: 4 }
        : { backgroundColor: index % 2 === 0 ? "#5bf0bd" : "#ffd166", borderColor: "#ffffff", borderWidth: 2 }
    });
    createLabel(context.layer, {
      anchor,
      text: shape,
      screenOffset: [0, 39],
      style: { color: "#ffffff", fontSize: 17 }
    });
  }
  context.frame(() => {
    const stats = context.backend.getStats();
    context.panel.status(`${stats.liveMarkers} shapes · ${stats.markerSprites} sprites · ${stats.markerDrawCalls} draw call`);
  });
}
