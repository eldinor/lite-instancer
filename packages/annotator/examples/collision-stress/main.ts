import {
  createLabel,
  disposeAnnotation,
  getAnnotationSnapshot,
  invalidateAnnotation,
  updateAnnotationLayer,
  updateLabel,
  type LabelCollisionMode,
  type LabelHandle,
  type ResolvableAnchor
} from "@litools/annotator";
import type { DemoContext } from "../shared/demo.js";

interface StressItem {
  readonly index: number;
  readonly baseX: number;
  readonly baseY: number;
  readonly baseZ: number;
  readonly phase: number;
  readonly position: Float32Array;
  reading: number;
  label: LabelHandle;
}

export function configureCollisionStress(ctx: DemoContext): void {
  const layer = ctx.recreateLayer("manual");
  ctx.panel.root.classList.add("demo-panel--stress");
  ctx.panel.root.querySelector(".status")?.classList.add("status--metrics");
  ctx.panel.describe("Move 100–500 labels through a dense field while comparing every collision mode.");

  const collisionModes: ReadonlyArray<Readonly<{ mode: LabelCollisionMode; label: string }>> = [
    { mode: "none", label: "Off" },
    { mode: "hide", label: "Hide" },
    { mode: "shift", label: "Shift" },
    { mode: "shift-x", label: "Shift X" },
    { mode: "shift-y", label: "Shift Y" },
    { mode: "radial", label: "Radial" },
    { mode: "cluster", label: "Cluster" },
    { mode: "repel", label: "Repel" }
  ];
  let activeMode: LabelCollisionMode = "hide";
  let items: StressItem[] = [];
  let simulationSeconds = 0;
  let textElapsed = 0;
  let statusElapsed = 0;
  let updateSamples: number[] = [];
  let latestUpdateMs = 0;

  for (const count of [100, 250, 500]) {
    ctx.panel.button(`${count} labels`, () => rebuild(count));
  }
  for (const entry of collisionModes) ctx.panel.button(entry.label, () => {
    activeMode = entry.mode;
    for (const item of items) updateLabel(item.label, { collision: activeMode });
    updateSamples = [];
    updateMetrics();
  });

  rebuild(250);

  ctx.frame((deltaMs) => {
    simulationSeconds += deltaMs / 1000;
    textElapsed += deltaMs;
    statusElapsed += deltaMs;

    for (const item of items) {
      const wave = simulationSeconds * 0.8 + item.phase;
      item.position[0] = item.baseX + Math.sin(wave * 1.7) * 0.22;
      item.position[1] = item.baseY + Math.cos(wave * 1.3) * 0.18;
      item.position[2] = item.baseZ + Math.sin(wave) * 0.28;
    }

    if (textElapsed >= 700) {
      textElapsed = 0;
      for (const item of items) {
        item.reading = 8 + ((item.reading * 1.37 + item.index * 0.19) % 92);
        invalidateAnnotation(item.label);
      }
    }

    const started = performance.now();
    updateAnnotationLayer(layer);
    latestUpdateMs = performance.now() - started;
    updateSamples.push(latestUpdateMs);
    if (updateSamples.length > 180) updateSamples.shift();

    if (statusElapsed >= 250) {
      statusElapsed = 0;
      updateMetrics();
    }
  });

  function rebuild(count: number): void {
    for (const item of items) disposeAnnotation(item.label);
    items = [];
    updateSamples = [];
    const goldenAngle = Math.PI * (3 - Math.sqrt(5));

    for (let index = 0; index < count; index++) {
      const normalized = (index + 0.5) / count;
      const angle = index * goldenAngle;
      const radius = Math.sqrt(normalized) * 4.8;
      const item = {
        index,
        baseX: Math.cos(angle) * radius,
        baseY: -0.7 + Math.sin(angle * 0.43) * 2.35,
        baseZ: Math.sin(angle) * radius * 0.58,
        phase: index * 0.31,
        position: new Float32Array(3),
        reading: 10 + ((index * 17) % 90),
        label: undefined as unknown as LabelHandle
      } satisfies StressItem;
      item.position.set([item.baseX, item.baseY, item.baseZ]);
      const anchor: ResolvableAnchor = {
        kind: "resolver",
        resolve(out) {
          out.set(item.position);
          return { available: true, targetVisible: true, position: out };
        }
      };
      item.label = createLabel(layer, {
        anchor,
        text: () => `S${String(index + 1).padStart(3, "0")} ${item.reading.toFixed(index % 4 === 0 ? 2 : 0)}%`,
        collision: activeMode,
        collisionPadding: 2,
        collisionMaxShift: 72,
        zIndex: count - index,
        clampToViewport: index % 12 === 0,
        hideWhenOffscreen: index % 12 !== 0,
        style: {
          color: "#eafff8",
          backgroundColor: "#081511df",
          borderColor: index % 9 === 0 ? "#71d7ff" : "#397f6a",
          borderWidth: 1,
          borderRadius: 4,
          padding: 3,
          fontSize: 10,
          fontWeight: 650,
          className: "annotation-label annotation-label--stress"
        }
      });
      items.push(item);
    }
    updateAnnotationLayer(layer);
    updateMetrics();
  }

  function updateMetrics(): void {
    let rendered = 0;
    let collisions = 0;
    let shifted = 0;
    for (const item of items) {
      const snapshot = getAnnotationSnapshot(item.label);
      if (snapshot.rendered) rendered++;
      else if (snapshot.hiddenReason === "collision") collisions++;
      if (snapshot.layoutOffset && (snapshot.layoutOffset.x !== 0 || snapshot.layoutOffset.y !== 0)) shifted++;
    }
    const sorted = [...updateSamples].sort((left, right) => left - right);
    const average = updateSamples.length
      ? updateSamples.reduce((total, value) => total + value, 0) / updateSamples.length
      : latestUpdateMs;
    const p95 = sorted.length ? sorted[Math.floor((sorted.length - 1) * 0.95)]! : latestUpdateMs;
    ctx.panel.status(
      `${activeMode} · ${items.length} total · ${rendered} visible\n` +
      `${shifted} shifted · ${collisions} hidden\n` +
      `last ${latestUpdateMs.toFixed(2)} ms · avg ${average.toFixed(2)} ms · p95 ${p95.toFixed(2)} ms`
    );
  }
}
