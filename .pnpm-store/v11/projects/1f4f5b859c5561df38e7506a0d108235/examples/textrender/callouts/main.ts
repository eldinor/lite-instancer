import { createLabel, createMarker, updateLabel, type LabelHandle } from "@litools/annotator";
import type { TextDemoContext } from "../shared.js";

export function configureGpuCallouts(context: TextDemoContext): void {
  context.panel.describe("Each callout combines one anchored marker, one offset GPU label, and one Sprite2D leader line.");
  const labels: LabelHandle[] = [];
  const entries = [
    { name: "Feed pump", position: [-4.2, 0, 0] as const, color: [0.12, 0.52, 0.38] as const, label: "P-101 · Running", offset: [-95, -72] as const, accent: "#5bf0bd" },
    { name: "Coolant", position: [-1.4, 0.25, 0] as const, color: [0.16, 0.46, 0.67] as const, label: "18.2 °C", offset: [78, -82] as const, accent: "#72e6ff" },
    { name: "Separator", position: [1.5, -0.1, 0] as const, color: [0.65, 0.4, 0.16] as const, label: "Pressure · 4.8 bar", offset: [-92, -76] as const, accent: "#ffc766" },
    { name: "Outlet", position: [4.4, 0.15, 0] as const, color: [0.42, 0.3, 0.62] as const, label: "Valve V-204", offset: [88, -68] as const, accent: "#d7b8ff" }
  ];
  for (const [index, entry] of entries.entries()) {
    const mesh = context.addBox(entry.name, entry.position, entry.color, 1.35);
    const anchor = { kind: "mesh" as const, mesh, point: [0, 0.68, 0] as const, space: "local" as const };
    createMarker(context.layer, {
      anchor,
      shape: index % 2 === 0 ? "ring" : "dot",
      size: index % 2 === 0 ? 24 : 18,
      style: { color: entry.accent, borderColor: "#ffffff", borderWidth: index % 2 === 0 ? 3 : 2 }
    });
    labels.push(createLabel(context.layer, {
      anchor,
      text: entry.label,
      screenOffset: entry.offset,
      clampToViewport: true,
      leaderLine: { color: entry.accent, width: 2, opacity: 0.85, minLength: 12 },
      style: { color: "#ffffff", fontSize: 18 }
    }));
  }

  let expanded = true;
  context.panel.button("Toggle offsets", () => {
    expanded = !expanded;
    for (const [index, label] of labels.entries()) {
      const offset = entries[index]!.offset;
      updateLabel(label, { screenOffset: expanded ? offset : [offset[0] * 0.58, offset[1] * 0.58] });
    }
  });
  context.frame(() => {
    const stats = context.backend.getStats();
    context.panel.status(`${stats.liveLabels} labels · ${stats.liveMarkers} markers · ${stats.leaderLineSprites} line sprites`);
  });
}
