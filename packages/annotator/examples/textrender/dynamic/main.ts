import { createLabel, invalidateAnnotation, type LabelHandle } from "@litools/annotator";
import type { TextRendererShapingMode } from "@litools/annotator/textrender";
import type { TextDemoContext } from "../shared.js";

export function configureDynamicText(context: TextDemoContext): void {
  context.panel.describe("Live callback text with cache and bridge diagnostics. Private shaping is explicit and guarded.");
  const mesh = context.addBox("Telemetry", [0, 0, 0], [0.2, 0.62, 0.46], 2.4);
  let mode: TextRendererShapingMode = "public";
  let value = 20;
  let label: LabelHandle;
  let elapsed = 0;
  let report = 0;

  const rebuild = () => {
    const layer = context.recreateLayer(mode);
    label = createLabel(layer, {
      anchor: { kind: "mesh", mesh, point: [0, 1.2, 0], space: "local" },
      text: () => `Temperature ${value.toFixed(1)} °C`,
      style: { color: mode === "public" ? "#ffd166" : "#d6b8ff", fontSize: 22 }
    });
  };
  rebuild();
  const toggle = context.panel.button("Mode: public", () => {
    mode = mode === "public" ? "guarded-private" : "public";
    toggle.textContent = `Mode: ${mode}`;
    rebuild();
  });
  context.frame((deltaMs) => {
    elapsed += deltaMs;
    report += deltaMs;
    if (elapsed >= 180) {
      elapsed = 0;
      value = 20 + Math.sin(performance.now() * 0.002) * 8;
      invalidateAnnotation(label!);
    }
    if (report >= 250) {
      report = 0;
      const stats = context.backend.getStats();
      context.panel.status(`${mode} · ${stats.cacheHits} hits · ${stats.cacheMisses} misses · ${stats.privateFallbacks} fallback`);
    }
  });
}
