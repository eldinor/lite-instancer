import { createLabel, invalidateAnnotation, updateAnnotationLayer, type LabelHandle, type ResolvableAnchor } from "@litools/annotator";
import type { TextDemoContext } from "../shared.js";

export function configureTextStress(context: TextDemoContext): void {
  context.panel.describe("Moving text-only labels with selectable 100–500 counts and live update/cache metrics.");
  let handles: LabelHandle[] = [];
  let anchors: Array<Float32Array> = [];
  let samples: number[] = [];
  let time = 0;

  const rebuild = (count: number) => {
    const layer = context.recreateLayer("public", "manual");
    handles = [];
    anchors = [];
    for (let index = 0; index < count; index++) {
      const position = new Float32Array(3);
      anchors.push(position);
      const anchor: ResolvableAnchor = {
        kind: "resolver",
        resolve(out) { out.set(position); return { available: true, targetVisible: true, position: out }; }
      };
      handles.push(createLabel(layer, {
        anchor,
        text: () => `P-${index % 40}`,
        collision: "hide",
        zIndex: count - index,
        style: { color: index % 9 === 0 ? "#71d7ff" : "#dcebe6", fontSize: 12 }
      }));
    }
    samples = [];
  };
  rebuild(100);
  for (const count of [100, 250, 500]) context.panel.button(String(count), () => rebuild(count));

  context.frame((deltaMs) => {
    time += deltaMs * 0.001;
    for (let index = 0; index < anchors.length; index++) {
      const angle = index * 2.399 + time * (0.12 + index % 7 * 0.006);
      const radius = 0.8 + Math.sqrt(index / Math.max(1, anchors.length)) * 5;
      const position = anchors[index]!;
      position[0] = Math.cos(angle) * radius;
      position[1] = Math.sin(angle * 1.7) * 1.4;
      position[2] = Math.sin(angle) * radius;
      if (index % 37 === 0 && Math.floor(time * 4) % 8 === 0) invalidateAnnotation(handles[index]!);
    }
    const start = performance.now();
    updateAnnotationLayer(context.layer);
    samples.push(performance.now() - start);
    if (samples.length > 120) samples.shift();
    const sorted = [...samples].sort((a, b) => a - b);
    const p95 = sorted[Math.floor((sorted.length - 1) * 0.95)] ?? 0;
    const stats = context.backend.getStats();
    context.panel.status(`${handles.length} labels · p95 ${p95.toFixed(2)} ms · ${stats.cacheHits} cache hits`);
  });
}
