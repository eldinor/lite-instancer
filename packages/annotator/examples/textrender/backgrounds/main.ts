import { createLabel, updateLabel, type AnnotationStyle, type LabelHandle } from "@litools/annotator";
import type { TextDemoContext } from "../shared.js";

interface CardPreset {
  readonly name: string;
  readonly position: readonly [number, number, number];
  readonly meshColor: readonly [number, number, number];
  readonly shortText: string;
  readonly longText: string;
  readonly style: Readonly<AnnotationStyle>;
}

export function configureGpuBackgrounds(context: TextDemoContext): void {
  context.panel.describe("Nine-slice Sprite2D cards preserve border and corner sizes as GPU text changes, while all cards in one z bucket remain one background draw call.");
  const presets: readonly CardPreset[] = [
    {
      name: "Coolant loop",
      position: [-4.5, 0.2, 0],
      meshColor: [0.1, 0.48, 0.38],
      shortText: "P-101 · Running",
      longText: "P-101 · Running · 72% load",
      style: cardStyle("#eafff8", "#0d332c", "#5bf0bd", 2, 8, 10, 20)
    },
    {
      name: "Coolant temperature",
      position: [-1.5, 0.45, 0],
      meshColor: [0.16, 0.46, 0.68],
      shortText: "18.2 °C",
      longText: "Coolant outlet · 18.2 °C",
      style: cardStyle("#ffffff", "#102b3d", "#72e6ff", 2, 14, 12, 24)
    },
    {
      name: "Pressure warning",
      position: [1.5, 0, 0],
      meshColor: [0.7, 0.39, 0.14],
      shortText: "Pressure high",
      longText: "Pressure high · 5.8 bar",
      style: cardStyle("#fff6df", "#4a260ee8", "#ffc766", 3, 5, 9, 20)
    },
    {
      name: "Maintenance",
      position: [4.5, 0.25, 0],
      meshColor: [0.42, 0.29, 0.62],
      shortText: "Service due",
      longText: "Valve V-204 · service due",
      style: cardStyle("#f6efff", "#25173bcc", "#d7b8ff", 1, 18, 11, 19)
    }
  ];
  const labels: LabelHandle[] = [];
  for (const [index, preset] of presets.entries()) {
    const mesh = context.addBox(preset.name, preset.position, preset.meshColor, 1.45);
    labels.push(createLabel(context.layer, {
      anchor: { kind: "mesh", mesh, point: [0, 0.75, 0], space: "local" },
      text: preset.shortText,
      screenOffset: [index % 2 === 0 ? -24 : 24, -62],
      clampToViewport: true,
      zIndex: index < 2 ? 1 : 2,
      leaderLine: { color: preset.style.borderColor ?? "#ffffff", width: 2, opacity: 0.72, minLength: 14 },
      style: preset.style
    }));
  }

  let expanded = false;
  context.panel.button("Toggle text length", () => {
    expanded = !expanded;
    for (const [index, label] of labels.entries()) {
      const preset = presets[index]!;
      updateLabel(label, { text: expanded ? preset.longText : preset.shortText, style: preset.style });
    }
  });

  let compact = false;
  context.panel.button("Toggle compact padding", () => {
    compact = !compact;
    for (const [index, label] of labels.entries()) {
      const preset = presets[index]!;
      updateLabel(label, {
        style: { ...preset.style, padding: compact ? 4 : (preset.style.padding ?? 0) }
      });
    }
  });

  context.frame(() => {
    const stats = context.backend.getStats();
    context.panel.status(`${stats.liveLabelBackgrounds} cards · ${stats.labelBackgroundSprites} patches · ${stats.labelBackgroundDrawCalls} background draws`);
  });
}

function cardStyle(
  color: string,
  backgroundColor: string,
  borderColor: string,
  borderWidth: number,
  borderRadius: number,
  padding: number,
  fontSize: number
): Readonly<AnnotationStyle> {
  return Object.freeze({ color, backgroundColor, borderColor, borderWidth, borderRadius, padding, fontSize });
}
