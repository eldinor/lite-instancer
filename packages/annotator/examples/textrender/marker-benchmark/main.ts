import { isGpuTimingSupported, setGpuTimingEnabled } from "@babylonjs/lite";
import {
  createMarker,
  getAnnotationSnapshot,
  setAnnotationVisible,
  updateAnnotationLayer,
  updateMarker,
  type AnnotationLayer,
  type MarkerHandle,
  type MarkerShape
} from "@litools/annotator";
import type {
  TextRendererAnnotationBackendStats
} from "@litools/annotator/textrender";
import type { TextDemoContext } from "../shared.js";

const shapes: readonly MarkerShape[] = ["dot", "square", "diamond", "triangle"];
const colors = ["#5bf0bd", "#72e6ff", "#ffd166", "#ff8a65"] as const;

type Workload = "static" | "cpu-pulse" | "gpu-pulse" | "visibility-churn" | "camera-orbit";
type BenchmarkMode = "quick" | "thorough";

interface BenchmarkProfile {
  readonly mode: BenchmarkMode;
  readonly settleFrames: number;
  readonly warmUpFrames: number;
  readonly sampleFrames: number;
  readonly rounds: number;
}

interface BenchmarkCase {
  readonly count: number;
  readonly workload: Workload;
  readonly zBuckets: number;
}

interface TimingSamples {
  readonly mutation: number[];
  readonly annotator: number[];
  readonly combined: number[];
  readonly frameDelta: number[];
  readonly gpuFrame: number[];
}

interface BackendCounterSnapshot {
  readonly fullMarkerUpdates: number;
  readonly markerPositionBatches: number;
  readonly batchedMarkerPositions: number;
}

interface CaseProgress {
  readonly configuration: BenchmarkCase;
  readonly preparationCpuMs: number;
  readonly newMarkers: number;
  readonly rounds: BenchmarkRoundResult[];
  firstFrameCpuMs: TimingSummary | null;
}

interface ActiveRun {
  readonly profile: BenchmarkProfile;
  caseIndex: number;
  roundIndex: number;
  settleRemaining: number;
  warmupRemaining: number;
  frame: number;
  startedAt: number;
  results: BenchmarkCaseResult[];
  current: CaseProgress;
  samples: TimingSamples;
  backendBaseline: BackendCounterSnapshot;
}

interface TimingSummary {
  readonly total: number;
  readonly mean: number;
  readonly p50: number;
  readonly p95: number;
  readonly max: number;
}

interface BenchmarkRoundResult {
  readonly round: number;
  readonly cpuTimingMs: {
    readonly mutation: TimingSummary;
    readonly annotatorUpdate: TimingSummary;
    readonly combined: TimingSummary;
  };
  readonly frameCadenceMs: TimingSummary;
  readonly droppedFrames: { readonly over16_7ms: number; readonly over33_3ms: number };
  readonly gpuFrameTimingMs: TimingSummary | null;
  readonly backendWork: BackendCounterSnapshot;
  readonly correctness: { readonly sampled: number; readonly rendered: number; readonly checksum: number };
}

interface BenchmarkCaseResult {
  readonly configuration: BenchmarkCase;
  readonly preparationCpuMs: number;
  readonly newMarkers: number;
  readonly firstFrameCpuMs: TimingSummary | null;
  readonly rounds: readonly BenchmarkRoundResult[];
  readonly median: Omit<BenchmarkRoundResult, "round" | "correctness">;
  readonly renderer: ReturnType<typeof rendererStats>;
}

const profiles: Record<BenchmarkMode, BenchmarkProfile> = {
  quick: { mode: "quick", settleFrames: 5, warmUpFrames: 15, sampleFrames: 60, rounds: 1 },
  thorough: { mode: "thorough", settleFrames: 15, warmUpFrames: 30, sampleFrames: 180, rounds: 3 }
};

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
  context.panel.describe("Run a quick check or a three-round benchmark. Reports separate application mutation, Annotator update, frame cadence, GPU frame time, fast-path work, and correctness samples through 10,000 markers.");
  let layer: AnnotationLayer = context.recreateLayer("public", "manual");
  const markers: MarkerHandle[] = [];
  const gpuTimingSupported = isGpuTimingSupported(context.engine);
  let run: ActiveRun | null = null;
  let reportJson = "";

  const quickButton = context.panel.button("Run quick benchmark", () => start("quick"));
  const thoroughButton = context.panel.button("Run thorough benchmark", () => start("thorough"));
  const stopButton = context.panel.button("Stop", stop);
  const copyButton = context.panel.button("Copy JSON", () => { void copyReport(); });
  stopButton.disabled = true;
  copyButton.disabled = true;

  context.frame((deltaMs) => {
    if (!run) {
      if (!reportJson) {
        const stats = context.backend.getStats();
        context.panel.status(`ready · ${stats.liveMarkers} markers · GPU timing ${gpuTimingSupported ? "available" : "unavailable"}`);
      }
      return;
    }

    const currentCase = cases[run.caseIndex]!;
    const mutationStartedAt = performance.now();
    applyWorkload(currentCase, run.frame++);
    const mutationMs = performance.now() - mutationStartedAt;
    const annotatorStartedAt = performance.now();
    updateAnnotationLayer(layer);
    const annotatorMs = performance.now() - annotatorStartedAt;
    const combinedMs = mutationMs + annotatorMs;

    if (!run.current.firstFrameCpuMs) run.current.firstFrameCpuMs = summarize([combinedMs]);

    if (run.settleRemaining > 0) {
      run.settleRemaining--;
      updateStatus(run, "settling", run.profile.settleFrames - run.settleRemaining, run.profile.settleFrames);
      return;
    }
    if (run.warmupRemaining > 0) {
      run.warmupRemaining--;
      updateStatus(run, "warming up", run.profile.warmUpFrames - run.warmupRemaining, run.profile.warmUpFrames);
      if (run.warmupRemaining === 0) run.backendBaseline = backendCounters(context.backend.getStats());
      return;
    }

    run.samples.mutation.push(mutationMs);
    run.samples.annotator.push(annotatorMs);
    run.samples.combined.push(combinedMs);
    run.samples.frameDelta.push(deltaMs);
    if (gpuTimingSupported && context.engine.gpuFrameTimeMs > 0) {
      run.samples.gpuFrame.push(context.engine.gpuFrameTimeMs);
    }
    updateStatus(run, "sampling", run.samples.combined.length, run.profile.sampleFrames);
    if (run.samples.combined.length === run.profile.sampleFrames) finishRound();
  });

  function start(mode: BenchmarkMode): void {
    if (run) return;
    layer = context.recreateLayer("public", "manual");
    markers.length = 0;
    reportJson = "";
    if (gpuTimingSupported) setGpuTimingEnabled(context.engine, true);
    const profile = profiles[mode];
    const current = prepareCase(cases[0]!);
    run = {
      profile,
      caseIndex: 0,
      roundIndex: 0,
      settleRemaining: profile.settleFrames,
      warmupRemaining: profile.warmUpFrames,
      frame: 0,
      startedAt: performance.now(),
      results: [],
      current,
      samples: createSamples(),
      backendBaseline: backendCounters(context.backend.getStats())
    };
    setRunningControls(true);
  }

  function stop(): void {
    run = null;
    if (gpuTimingSupported) setGpuTimingEnabled(context.engine, false);
    setRunningControls(false);
    context.panel.status("stopped · partial results discarded");
  }

  function setRunningControls(running: boolean): void {
    quickButton.disabled = running;
    thoroughButton.disabled = running;
    stopButton.disabled = !running;
    copyButton.disabled = running || !reportJson;
  }

  function prepareCase(current: BenchmarkCase): CaseProgress {
    const previousCount = markers.length;
    const startedAt = performance.now();
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
    return {
      configuration: current,
      preparationCpuMs: performance.now() - startedAt,
      newMarkers: markers.length - previousCount,
      rounds: [],
      firstFrameCpuMs: null
    };
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

  function finishRound(): void {
    if (!run) return;
    const stats = context.backend.getStats();
    const counters = backendCounters(stats);
    run.current.rounds.push({
      round: run.roundIndex + 1,
      cpuTimingMs: {
        mutation: summarize(run.samples.mutation),
        annotatorUpdate: summarize(run.samples.annotator),
        combined: summarize(run.samples.combined)
      },
      frameCadenceMs: summarize(run.samples.frameDelta),
      droppedFrames: {
        over16_7ms: run.samples.frameDelta.filter((value) => value > 16.7).length,
        over33_3ms: run.samples.frameDelta.filter((value) => value > 33.3).length
      },
      gpuFrameTimingMs: run.samples.gpuFrame.length > 0 ? summarize(run.samples.gpuFrame) : null,
      backendWork: subtractCounters(counters, run.backendBaseline),
      correctness: correctnessChecksum(markers, cases[run.caseIndex]!.count)
    });
    run.roundIndex++;
    if (run.roundIndex < run.profile.rounds) {
      resetRound(run);
      return;
    }
    finishCase(stats);
  }

  function finishCase(stats: TextRendererAnnotationBackendStats): void {
    if (!run) return;
    const current = run.current;
    run.results.push({
      configuration: current.configuration,
      preparationCpuMs: current.preparationCpuMs,
      newMarkers: current.newMarkers,
      firstFrameCpuMs: current.firstFrameCpuMs,
      rounds: current.rounds,
      median: medianRounds(current.rounds),
      renderer: rendererStats(stats)
    });
    run.caseIndex++;
    if (run.caseIndex === cases.length) {
      finishRun(run);
      return;
    }
    run.roundIndex = 0;
    run.current = prepareCase(cases[run.caseIndex]!);
    resetRound(run);
  }

  function resetRound(active: ActiveRun): void {
    active.settleRemaining = active.profile.settleFrames;
    active.warmupRemaining = active.profile.warmUpFrames;
    active.frame = 0;
    active.samples = createSamples();
    active.backendBaseline = backendCounters(context.backend.getStats());
  }

  function finishRun(completed: ActiveRun): void {
    const report = {
      benchmark: "annotator-textrender-high-count-markers",
      workloadVersion: 3,
      timestamp: new Date().toISOString(),
      environment: {
        userAgent: navigator.userAgent,
        devicePixelRatio: window.devicePixelRatio,
        viewportCss: { width: context.canvas.clientWidth, height: context.canvas.clientHeight },
        backingStore: { width: context.canvas.width, height: context.canvas.height },
        hardwareConcurrency: navigator.hardwareConcurrency,
        deviceMemoryGiB: (navigator as Navigator & { deviceMemory?: number }).deviceMemory ?? null,
        crossOriginIsolated: globalThis.crossOriginIsolated,
        gpuTimingSupported
      },
      suite: {
        profile: completed.profile,
        cases: cases.length,
        elapsedMs: performance.now() - completed.startedAt,
        timingScope: {
          mutation: "application workload only",
          annotatorUpdate: "updateAnnotationLayer only",
          combined: "mutation plus updateAnnotationLayer; excludes rendering",
          frameCadence: "Lite onBeforeRender delta; includes frame scheduling",
          gpuFrame: "Lite asynchronous whole-frame GPU timestamp when supported"
        }
      },
      results: completed.results
    };
    reportJson = JSON.stringify(report, null, 2);
    run = null;
    if (gpuTimingSupported) setGpuTimingEnabled(context.engine, false);
    setRunningControls(false);
    copyButton.disabled = false;
    const stats = context.backend.getStats();
    context.panel.status(`complete · ${stats.liveMarkers.toLocaleString()} markers · ${completed.profile.mode} JSON ready`);
  }

  function updateStatus(active: ActiveRun, phase: string, current: number, total: number): void {
    const configuration = cases[active.caseIndex]!;
    context.panel.status(
      `${active.profile.mode} · case ${active.caseIndex + 1}/${cases.length} · round ${active.roundIndex + 1}/${active.profile.rounds} · ${configuration.count.toLocaleString()} ${configuration.workload} · ${phase} ${current}/${total}`
    );
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

function createSamples(): TimingSamples {
  return { mutation: [], annotator: [], combined: [], frameDelta: [], gpuFrame: [] };
}

function summarize(samples: readonly number[]): TimingSummary {
  const sorted = [...samples].sort((a, b) => a - b);
  const total = samples.reduce((sum, value) => sum + value, 0);
  return {
    total,
    mean: samples.length > 0 ? total / samples.length : 0,
    p50: percentile(sorted, 0.5),
    p95: percentile(sorted, 0.95),
    max: sorted.at(-1) ?? 0
  };
}

function medianRounds(rounds: readonly BenchmarkRoundResult[]): Omit<BenchmarkRoundResult, "round" | "correctness"> {
  return {
    cpuTimingMs: {
      mutation: medianTiming(rounds.map((round) => round.cpuTimingMs.mutation)),
      annotatorUpdate: medianTiming(rounds.map((round) => round.cpuTimingMs.annotatorUpdate)),
      combined: medianTiming(rounds.map((round) => round.cpuTimingMs.combined))
    },
    frameCadenceMs: medianTiming(rounds.map((round) => round.frameCadenceMs)),
    droppedFrames: {
      over16_7ms: median(rounds.map((round) => round.droppedFrames.over16_7ms)),
      over33_3ms: median(rounds.map((round) => round.droppedFrames.over33_3ms))
    },
    gpuFrameTimingMs: rounds.every((round) => round.gpuFrameTimingMs !== null)
      ? medianTiming(rounds.map((round) => round.gpuFrameTimingMs!))
      : null,
    backendWork: {
      fullMarkerUpdates: median(rounds.map((round) => round.backendWork.fullMarkerUpdates)),
      markerPositionBatches: median(rounds.map((round) => round.backendWork.markerPositionBatches)),
      batchedMarkerPositions: median(rounds.map((round) => round.backendWork.batchedMarkerPositions))
    }
  };
}

function medianTiming(values: readonly TimingSummary[]): TimingSummary {
  return {
    total: median(values.map((value) => value.total)),
    mean: median(values.map((value) => value.mean)),
    p50: median(values.map((value) => value.p50)),
    p95: median(values.map((value) => value.p95)),
    max: median(values.map((value) => value.max))
  };
}

function backendCounters(stats: TextRendererAnnotationBackendStats): BackendCounterSnapshot {
  return {
    fullMarkerUpdates: stats.fullMarkerUpdates,
    markerPositionBatches: stats.markerPositionBatches,
    batchedMarkerPositions: stats.batchedMarkerPositions
  };
}

function subtractCounters(current: BackendCounterSnapshot, baseline: BackendCounterSnapshot): BackendCounterSnapshot {
  return {
    fullMarkerUpdates: current.fullMarkerUpdates - baseline.fullMarkerUpdates,
    markerPositionBatches: current.markerPositionBatches - baseline.markerPositionBatches,
    batchedMarkerPositions: current.batchedMarkerPositions - baseline.batchedMarkerPositions
  };
}

function correctnessChecksum(
  markers: readonly MarkerHandle[],
  count: number
): { sampled: number; rendered: number; checksum: number } {
  const sampled = Math.min(32, count);
  let rendered = 0;
  let checksum = 2166136261;
  for (let sample = 0; sample < sampled; sample++) {
    const index = Math.min(count - 1, Math.floor(sample * count / sampled));
    const snapshot = getAnnotationSnapshot(markers[index]!);
    if (snapshot.rendered) rendered++;
    const x = Math.round((snapshot.screenPosition?.x ?? -1) * 100);
    const y = Math.round((snapshot.screenPosition?.y ?? -1) * 100);
    checksum = Math.imul(checksum ^ x, 16777619);
    checksum = Math.imul(checksum ^ y, 16777619);
    checksum = Math.imul(checksum ^ (snapshot.rendered ? 1 : 0), 16777619);
  }
  return { sampled, rendered, checksum: checksum >>> 0 };
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

function median(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) * 0.5
    : sorted[middle] ?? 0;
}
