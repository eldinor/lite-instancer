import { createLabel, createMarker } from "@litools/annotator";
import type { TextDemoContext } from "../shared.js";

export function configureBasicText(context: TextDemoContext): void {
  context.panel.describe("Batched GPU labels, dots, and rings retain Annotator anchors, clamping, visibility, and DPR sizing.");
  const entries = [
    { name: "Pump A-12", position: [-3, 0, 0] as const, color: [0.2, 0.65, 0.48] as const, text: "Pump A-12", fontSize: 20, textColor: "#ffd166" },
    { name: "Coolant", position: [0, 0.4, 0] as const, color: [0.18, 0.5, 0.68] as const, text: "Coolant 18.2 °C", fontSize: 26, textColor: "#ffffff" },
    { name: "Warning", position: [3, -0.15, 0] as const, color: [0.72, 0.43, 0.18] as const, text: "Pressure high", fontSize: 18, textColor: "#72e6ff" }
  ];
  for (const [index, entry] of entries.entries()) {
    const mesh = context.addBox(entry.name, entry.position, entry.color);
    createLabel(context.layer, {
      // Lite primitive factories expose geometry-local bounds. An explicit local
      // point follows the mesh transform and keeps each moved box anchor distinct.
      anchor: { kind: "mesh", mesh, point: [0, 0.9, 0], space: "local" },
      text: entry.text,
      clampToViewport: true,
      zIndex: index,
      style: { color: entry.textColor, fontSize: entry.fontSize }
    });
  }
  createLabel(context.layer, {
    anchor: { kind: "world", position: [0, 3.2, 0] },
    text: "World anchor · DPR aware",
    clampToViewport: true,
    style: { color: "#5bf0bd", fontSize: 16, opacity: 0.85 }
  });
  createMarker(context.layer, {
    anchor: { kind: "world", position: [-4.4, 2.25, 0] },
    shape: "dot",
    size: 24,
    clampToViewport: true,
    style: { backgroundColor: "#ffc766", borderColor: "#ffffff", borderWidth: 3 }
  });
  createMarker(context.layer, {
    anchor: { kind: "world", position: [0, 2.45, 0] },
    shape: "ring",
    size: 34,
    clampToViewport: true,
    style: { color: "#5bf0bd", borderWidth: 4 }
  });
  createMarker(context.layer, {
    anchor: { kind: "world", position: [4.4, 2.25, 0] },
    shape: "dot",
    size: 18,
    clampToViewport: true,
    style: { color: "#72e6ff", opacity: 0.75 }
  });
}
