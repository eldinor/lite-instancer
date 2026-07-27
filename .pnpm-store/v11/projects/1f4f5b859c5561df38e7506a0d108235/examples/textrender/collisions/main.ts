import {
  createLabel,
  getAnnotationSnapshot,
  updateAnnotationLayer,
  updateLabel,
  type LabelCollisionMode,
  type LabelHandle,
  type LeaderLineOptions
} from "@litools/annotator";
import type { TextDemoContext } from "../shared.js";

const WARM_UP_FRAMES = 30;
const SAMPLE_FRAMES = 180;

interface LinePreset {
  readonly name: string;
  readonly color: string;
  readonly width: number;
  readonly opacity: number;
}

const presets: readonly LinePreset[] = [
  { name: "Fast white", color: "#ffffff", width: 1.5, opacity: 0.78 },
  { name: "Amber", color: "#ffc766", width: 2.5, opacity: 0.92 },
  { name: "Wide cyan", color: "#71d7ff", width: 4, opacity: 0.68 }
];

export function configureTextCollisions(context: TextDemoContext): void {
  context.panel.describe("GPU collision shifts with fast square leader lines, optional rounded caps, and a manual JSON benchmark.");
  const layer = context.recreateLayer("public", "manual");
  const labels: LabelHandle[] = [];
  let selectedMode: LabelCollisionMode = "shift";
  let selectedCap: NonNullable<LeaderLineOptions["lineCap"]> = "square";
  let selectedPreset = presets[0]!;
  let benchmark: { warmup: number; samples: number[] } | null = null;
  let benchmarkJson = "";

  for (let index = 0; index < 12; index++) {
    const angle = index / 12 * Math.PI * 2;
    const mesh = context.addBox(
      `Sensor ${index + 1}`,
      [Math.cos(angle) * 5.4, Math.sin(angle * 2) * 0.7, Math.sin(angle) * 5.4],
      [0.15, 0.48 + index * 0.012, 0.4],
      1.15
    );
    labels.push(createLabel(layer, {
      anchor: { kind: "mesh", mesh, point: [0, 0.575, 0], space: "local" },
      text: `Sensor station ${String(index + 1).padStart(2, "0")}`,
      collision: selectedMode,
      collisionPadding: 54,
      collisionMaxShift: 150,
      leaderLine: lineOptions(),
      // Keep benchmark labels in one TextRenderer bucket. Collision priority
      // remains deterministic through annotation creation order.
      zIndex: 10,
      style: { color: index % 3 === 0 ? "#ffd166" : "#ffffff", fontSize: 18 }
    }));
  }

  const modes: readonly LabelCollisionMode[] = ["none", "hide", "shift", "shift-x", "shift-y", "radial", "cluster", "repel"];
  for (const mode of modes) {
    context.panel.button(mode, () => {
      selectedMode = mode;
      for (const label of labels) updateLabel(label, { collision: mode });
    });
  }
  context.panel.button("Square caps", () => setCap("square"));
  context.panel.button("Round caps", () => setCap("round"));
  for (const preset of presets) {
    context.panel.button(preset.name, () => {
      selectedPreset = preset;
      applyLineOptions();
    });
  }

  const runButton = context.panel.button("Run benchmark", () => {
    benchmark = { warmup: WARM_UP_FRAMES, samples: [] };
    benchmarkJson = "";
    copyButton.disabled = true;
  });
  const copyButton = context.panel.button("Copy JSON", () => { void copyBenchmark(); });
  copyButton.disabled = true;

  context.frame(() => {
    const start = performance.now();
    updateAnnotationLayer(layer);
    const elapsed = performance.now() - start;
    if (benchmark) {
      if (benchmark.warmup > 0) benchmark.warmup--;
      else benchmark.samples.push(elapsed);
      if (benchmark.samples.length === SAMPLE_FRAMES) finishBenchmark(benchmark.samples);
    }
    const hidden = labels.filter((label) => getAnnotationSnapshot(label).hiddenReason === "collision").length;
    const stats = context.backend.getStats();
    const progress = benchmark
      ? benchmark.warmup > 0
        ? ` · warm-up ${WARM_UP_FRAMES - benchmark.warmup}/${WARM_UP_FRAMES}`
        : ` · sample ${benchmark.samples.length}/${SAMPLE_FRAMES}`
      : "";
    context.panel.status(
      `${selectedMode} · ${selectedCap} · ${hidden} hidden · ${stats.liveLeaderLines} lines · ${stats.leaderLineSprites} sprites${progress}`
    );
  });

  function lineOptions(): LeaderLineOptions {
    return {
      color: selectedPreset.color,
      width: selectedPreset.width,
      opacity: selectedPreset.opacity,
      lineCap: selectedCap,
      minLength: 8
    };
  }

  function setCap(cap: NonNullable<LeaderLineOptions["lineCap"]>): void {
    selectedCap = cap;
    applyLineOptions();
  }

  function applyLineOptions(): void {
    for (const label of labels) updateLabel(label, { leaderLine: lineOptions() });
  }

  function finishBenchmark(samples: number[]): void {
    const sorted = [...samples].sort((a, b) => a - b);
    const sum = samples.reduce((total, value) => total + value, 0);
    const stats = context.backend.getStats();
    benchmarkJson = JSON.stringify({
      benchmark: "annotator-textrender-sprite2d-leader-lines",
      timestamp: new Date().toISOString(),
      environment: {
        userAgent: navigator.userAgent,
        devicePixelRatio: window.devicePixelRatio,
        viewportCss: { width: context.canvas.clientWidth, height: context.canvas.clientHeight },
        backingStore: { width: context.canvas.width, height: context.canvas.height }
      },
      configuration: {
        labels: labels.length,
        collisionMode: selectedMode,
        lineCap: selectedCap,
        linePreset: selectedPreset,
        warmUpFrames: WARM_UP_FRAMES,
        sampleFrames: SAMPLE_FRAMES
      },
      updateTimingMs: {
        mean: sum / samples.length,
        p50: percentile(sorted, 0.5),
        p95: percentile(sorted, 0.95),
        max: sorted.at(-1) ?? 0
      },
      renderer: {
        spriteBuckets: stats.spriteBuckets,
        spriteDrawCalls: stats.spriteDrawCalls,
        textBuckets: stats.textBuckets,
        textDrawCalls: stats.textDrawCalls,
        leaderLineDrawCalls: stats.leaderLineDrawCalls,
        liveLeaderLines: stats.liveLeaderLines,
        leaderLineSprites: stats.leaderLineSprites,
        liveLabels: stats.liveLabels
      },
      shaping: {
        cacheHits: stats.cacheHits,
        cacheMisses: stats.cacheMisses,
        publicShapes: stats.publicShapes,
        privateShapes: stats.privateShapes,
        privateFallbacks: stats.privateFallbacks
      }
    }, null, 2);
    benchmark = null;
    copyButton.disabled = false;
    runButton.textContent = "Run again";
  }

  async function copyBenchmark(): Promise<void> {
    if (!benchmarkJson) return;
    try {
      await navigator.clipboard.writeText(benchmarkJson);
      context.panel.status("Benchmark JSON copied");
    } catch {
      const output = context.panel.output(benchmarkJson);
      output.focus();
      output.select();
      context.panel.status("Clipboard unavailable · select and copy the JSON below");
    }
  }
}

function percentile(sorted: readonly number[], fraction: number): number {
  if (sorted.length === 0) return 0;
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * fraction) - 1)]!;
}
