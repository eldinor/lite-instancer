import {
  createLabel,
  disposeAnnotation,
  setAnnotationVisible,
  type LabelHandle
} from "@litools/annotator";
import type { DemoContext } from "../shared/demo.js";

export function configureLabels(ctx: DemoContext): void {
  const layer = ctx.layer!;
  ctx.panel.describe("Labels use mesh-local anchor points, screen offsets, portable styles, and CSS classes.");

  const pump = ctx.addBox("Pump A-12", [-3.1, -0.35, 0], [0.12, 0.58, 0.48], 2.2);
  const valve = ctx.addBox("Valve B-07", [0, -0.65, 0], [0.16, 0.4, 0.7], 1.55);
  const warning = ctx.addBox("Filter C-03", [3.1, -0.15, 0], [0.72, 0.36, 0.12], 2.55);
  pump.rotation.y = 0.25;
  valve.rotation.y = -0.35;
  warning.rotation.y = 0.42;

  const commonStyle = {
    color: "#f5fffc",
    backgroundColor: "#0a1715e8",
    borderColor: "#5bf0bd",
    borderWidth: 1,
    borderRadius: 7,
    padding: 7,
    className: "annotation-label"
  };
  const pumpLabel = createLabel(layer, {
    anchor: { kind: "mesh", mesh: pump, point: [0, 1.25, 0] },
    text: "Pump A-12",
    screenOffset: [0, -8],
    clampToViewport: true,
    style: commonStyle,
    ariaLabel: "Pump A-12 annotation",
    role: "note"
  });
  const valveLabel = createLabel(layer, {
    anchor: { kind: "mesh", mesh: valve, point: [0, 1, 0] },
    text: "Valve B-07",
    screenOffset: [0, -8],
    style: { ...commonStyle, borderColor: "#71d7ff", className: "annotation-label annotation-label--cyan" }
  });
  let warningLabel: LabelHandle | undefined = createLabel(layer, {
    anchor: { kind: "mesh", mesh: warning, point: [0, 1.45, 0] },
    text: "Filter C-03 · service due",
    screenOffset: [0, -8],
    style: { ...commonStyle, borderColor: "#ffc766", className: "annotation-label annotation-label--warning" }
  });

  let labelsVisible = true;
  ctx.panel.button("Show / hide labels", () => {
    labelsVisible = !labelsVisible;
    setAnnotationVisible(pumpLabel, labelsVisible);
    setAnnotationVisible(valveLabel, labelsVisible);
    if (warningLabel) setAnnotationVisible(warningLabel, labelsVisible);
    ctx.panel.status(labelsVisible ? "labels visible" : "labels hidden");
  });
  ctx.panel.button("Dispose warning", () => {
    if (!warningLabel) return;
    disposeAnnotation(warningLabel);
    warningLabel = undefined;
    ctx.panel.status("warning label disposed");
  });

  let elapsed = 0;
  ctx.frame((deltaMs) => {
    elapsed += deltaMs / 1000;
    pump.rotation.y += deltaMs * 0.00012;
    valve.position.y = -0.65 + Math.sin(elapsed * 1.4) * 0.18;
  });
}
