import { createLabel, updateLabel, type AnnotationStyle, type LabelHandle } from "@litools/annotator";
import type { TextDemoContext } from "../shared.js";

interface ComparisonLabel {
  readonly nineSlice: LabelHandle;
  readonly roundedCard: LabelHandle;
  readonly shortText: string;
  readonly longText: string;
  readonly style: Readonly<AnnotationStyle>;
}

export function configureBackgroundModes(context: TextDemoContext): void {
  context.panel.describe(
    "The left column uses the default nine-slice background. The right column opts into one analytic rounded-card sprite per label. Both columns use identical label styles."
  );
  const rounded = context.createAdditionalLayer("rounded-card");
  const presets = [
    {
      text: "Pump P-101",
      longText: "Pump P-101 · Running · 72% load",
      y: 1.8,
      color: [0.1, 0.48, 0.38] as const,
      style: cardStyle("#eafff8", "#0d332c", "#5bf0bd", 2, 8, 10, 20)
    },
    {
      text: "18.2 °C",
      longText: "Coolant outlet · 18.2 °C",
      y: 0,
      color: [0.16, 0.46, 0.68] as const,
      style: cardStyle("#ffffff", "#102b3d", "#72e6ff", 2, 14, 12, 24)
    },
    {
      text: "Pressure high",
      longText: "Pressure high · 5.8 bar",
      y: -1.8,
      color: [0.7, 0.39, 0.14] as const,
      style: cardStyle("#fff6df", "#4a260ee8", "#ffc766", 3, 5, 9, 20)
    }
  ];
  const labels: ComparisonLabel[] = [];

  for (const [index, preset] of presets.entries()) {
    const left = context.addBox(`Nine-slice ${preset.text}`, [-3.2, preset.y, 0], preset.color, 1.1);
    const right = context.addBox(`Rounded card ${preset.text}`, [3.2, preset.y, 0], preset.color, 1.1);
    const common = {
      text: preset.text,
      screenOffset: [0, -58] as const,
      zIndex: index,
      style: preset.style
    };
    labels.push({
      nineSlice: createLabel(context.layer, {
        ...common,
        anchor: { kind: "mesh", mesh: left, point: [0, 0.58, 0], space: "local" }
      }),
      roundedCard: createLabel(rounded.layer, {
        ...common,
        anchor: { kind: "mesh", mesh: right, point: [0, 0.58, 0], space: "local" }
      }),
      shortText: preset.text,
      longText: preset.longText,
      style: preset.style
    });
  }

  let expanded = false;
  context.panel.button("Toggle text length", () => {
    expanded = !expanded;
    for (const entry of labels) {
      const text = expanded ? entry.longText : entry.shortText;
      updateLabel(entry.nineSlice, { text });
      updateLabel(entry.roundedCard, { text });
    }
  });

  let compact = false;
  context.panel.button("Toggle padding", () => {
    compact = !compact;
    for (const entry of labels) {
      const style = { ...entry.style, padding: compact ? 4 : (entry.style.padding ?? 0) };
      updateLabel(entry.nineSlice, { style });
      updateLabel(entry.roundedCard, { style });
    }
  });

  context.frame(() => {
    const nineStats = context.backend.getStats();
    const roundedStats = rounded.backend.getStats();
    context.panel.status(
      `nine-slice: ${nineStats.labelBackgroundSprites} sprites / ${nineStats.labelBackgroundDrawCalls} draws · ` +
      `rounded-card: ${roundedStats.labelBackgroundSprites} sprites / ${roundedStats.roundedCardDrawCalls} draws`
    );
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
