import {
  createMarker,
  disposeAnnotation,
  setAnnotationVisible,
  updateAnnotationLayer,
  updateMarker,
  type MarkerHandle,
  type MarkerShape
} from "@litools/annotator";
import type { TextRendererAnnotationBackendStats } from "@litools/annotator/textrender";
import type { TextDemoContext } from "../shared.js";

const WARM_UP_FRAMES = 15;
const SAMPLE_FRAMES = 60;
const shapes: readonly MarkerShape[] = ["dot", "square", "diamond", "triangle"];
const colors = ["#5bf0bd", "#72e6ff", "#ffd166", "#ff8a65"] as const;

type Workload = "static" | "cpu-pulse" | "gpu-pulse" | "visibility-churn" | "camera-orbit";

interface BenchmarkCase {
  readonly count: number;
  readonly workload: Workload;
  readonly zBuckets: number;
}

interface ActiveRun {
  caseIndex: number;
  warmup: number;
  samples: number[];
  frame: number;
  startedAt: number;
  results: object[];
}

const cases: readonly BenchmarkCase[] = [
  { count: 100, workload: "static", zBuckets: 1 },
  { count: 500, workload: "static", zBuckets: 1 },
  { count: 1_000, workload: "static", zBuckets: 1 },
  { count: 5_000, workload: "static", zBuckets: 1 },
  { count: 10_000, workload: "static", zBuckets: 1 },
  { count: 10_000, workload: "static", zBuckets: 4 },
  { count: 10_000, workload: "cpu-pulse", zBuckets: 1 },
  { count: 10_000, workload: "gpu-pulse", zBuckets: 1 },
  { count: 10_000, workload: "visibility-churn", zBuckets: 1 },
  { count: 10_000, workload: "camera-orbit", zBuckets: 1 }
];

export function configureGpuMarkerBenchmark(context: TextDemoContext): void {
  context.panel.describe("Press Start once; ten automatic cases compare cached scaling, z buckets, CPU/GPU pulse, visibility, and batched camera-movement projection through 10,000 markers.");
  const layer = context.recreateLayer("public", "manual");
  const markers: MarkerHandle[] = [];
  let run: ActiveRun | null = null;
  let reportJson = "";

  const startButton = context.panel.button("Start automatic benchmark", start);
  const stopButton = context.panel.button("Stop", stop);
  const copyButton = context.panel.button("Copy JSON", () => { void copyReport(); });
  stopButton.disabled = true;
  copyButton.disabled = true;

  context.frame(() => {
    if (!run) {
      if (!reportJson) {
        const stats = context.backend.getStats();
        context.panel.status(`ready · ${stats.liveMarkers} markers · press Start`);
      }
      return;
    }
    const current = cases[run.caseIndex]!;
    const startTime = performance.now();
    applyWorkload(current, run.frame++);
    updateAnnotationLayer(layer);
    const elapsed = performance.now() - startTime;

    if (run.warmup > 0) run.warmup--;
    else run.samples.push(elapsed);

    const phase = run.warmup > 0
      ? `warm-up ${WARM_UP_FRAMES - run.warmup}/${WARM_UP_FRAMES}`
      : `sample ${run.samples.length}/${SAMPLE_FRAMES}`;
    context.panel.status(
      `case ${run.caseIndex + 1}/${cases.length} · ${current.count.toLocaleString()} · ${current.workload} · ${current.zBuckets} bucket${current.zBuckets === 1 ? "" : "s"} · ${phase}`
    );
    if (run.samples.length === SAMPLE_FRAMES) finishCase(current);
  });

  function start(): void {
    if (run) return;
    for (const marker of markers) disposeAnnotation(marker);
    markers.length = 0;
    reportJson = "";
    run = { caseIndex: 0, warmup: WARM_UP_FRAMES, samples: [], frame: 0, startedAt: performance.now(), results: [] };
    startButton.disabled = true;
    stopButton.disabled = false;
    copyButton.disabled = true;
    prepareCase(cases[0]!);
  }

  function stop(): void {
    run = null;
    startButton.disabled = false;
    stopButton.disabled = true;
    context.panel.status("stopped · partial results discarded");
  }

  function prepareCase(current: BenchmarkCase): void {
    ensureMarkerCount(current.count);
    for (let index = 0; index < markers.length; index++) {
      const marker = markers[index]!;
      setAnnotationVisible(marker, index < current.count);
      if (index < current.count) updateMarker(marker, {
        size: 10,
        zIndex: index % current.zBuckets,
        style: markerStyle(index, 1),
        animation: current.workload === "gpu-pulse"
          ? { type: "pulse", frequency: 0.8 + index % 5 * 0.12, phase: index * 0.017, minOpacity: 0.35 }
          : null
      });
    }
  }

  function ensureMarkerCount(count: number): void {
    for (let index = markers.length; index < count; index++) {
      const x = (((index * 0.61803398875) % 1) - 0.5) * 11;
      const y = (((index * 0.41421356237) % 1) - 0.5) * 6;
      const z = Math.sin(index * 0.37) * 0.7;
      markers.push(createMarker(layer, {
        anchor: { kind: "world", position: [x, y, z] },
        shape: shapes[index % shapes.length]!,
        size: 10,
        style: markerStyle(index, 1)
      }));
    }
  }

  function applyWorkload(current: BenchmarkCase, frame: number): void {
    if (current.workload === "static" || current.workload === "gpu-pulse") return;
    if (current.workload === "camera-orbit") {
      context.camera.alpha += 0.0025;
      return;
    }
    for (let index = 0; index < current.count; index++) {
      const marker = markers[index]!;
      if (current.workload === "cpu-pulse") {
        const wave = 0.5 + 0.5 * Math.sin(frame * 0.12 + index * 0.17);
        updateMarker(marker, { size: 7 + wave * 7, style: markerStyle(index, 0.35 + wave * 0.65) });
      } else {
        setAnnotationVisible(marker, (index + frame) % 8 !== 0);
      }
    }
  }

  function markerStyle(index: number, opacity: number) {
    return { backgroundColor: colors[index % colors.length]!, opacity };
  }

  function finishCase(current: BenchmarkCase): void {
    if (!run) return;
    const stats = context.backend.getStats();
    run.results.push({
      configuration: current,
      updateTimingMs: summarize(run.samples),
      renderer: rendererStats(stats)
    });
    run.caseIndex++;
    if (run.caseIndex === cases.length) {
      finishRun(run);
      return;
    }
    run.warmup = WARM_UP_FRAMES;
    run.samples = [];
    run.frame = 0;
    prepareCase(cases[run.caseIndex]!);
  }

  function finishRun(completed: ActiveRun): void {
    reportJson = JSON.stringify({
      benchmark: "annotator-textrender-high-count-markers",
      timestamp: new Date().toISOString(),
      environment: {
        userAgent: navigator.userAgent,
        devicePixelRatio: window.devicePixelRatio,
        viewportCss: { width: context.canvas.clientWidth, height: context.canvas.clientHeight },
        backingStore: { width: context.canvas.width, height: context.canvas.height }
      },
      suite: {
        warmUpFrames: WARM_UP_FRAMES,
        sampleFrames: SAMPLE_FRAMES,
        cases: cases.length,
        elapsedMs: performance.now() - completed.startedAt
      },
      results: completed.results
    }, null, 2);
    run = null;
    startButton.disabled = false;
    startButton.textContent = "Run again";
    stopButton.disabled = true;
    copyButton.disabled = false;
    const stats = context.backend.getStats();
    context.panel.status(`complete · ${stats.liveMarkers.toLocaleString()} markers · ${stats.spriteBuckets} bucket · JSON ready`);
  }

  async function copyReport(): Promise<void> {
    if (!reportJson) return;
    try {
      await navigator.clipboard.writeText(reportJson);
      context.panel.status("Benchmark JSON copied");
    } catch {
      const output = context.panel.output(reportJson);
      output.focus();
      output.select();
      context.panel.status("Clipboard unavailable · select and copy the JSON below");
    }
  }
}

function summarize(samples: readonly number[]) {
  const sorted = [...samples].sort((a, b) => a - b);
  const sum = samples.reduce((total, value) => total + value, 0);
  return {
    mean: sum / samples.length,
    p50: percentile(sorted, 0.5),
    p95: percentile(sorted, 0.95),
    max: sorted.at(-1) ?? 0
  };
}

function rendererStats(stats: TextRendererAnnotationBackendStats) {
  return {
    liveMarkers: stats.liveMarkers,
    liveAnimatedMarkers: stats.liveAnimatedMarkers,
    markerSprites: stats.markerSprites,
    spriteBuckets: stats.spriteBuckets,
    spriteDrawCalls: stats.spriteDrawCalls,
    markerDrawCalls: stats.markerDrawCalls,
    animatedMarkerDrawCalls: stats.animatedMarkerDrawCalls
  };
}

function percentile(sorted: readonly number[], fraction: number): number {
  if (sorted.length === 0) return 0;
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * fraction) - 1)]!;
}
