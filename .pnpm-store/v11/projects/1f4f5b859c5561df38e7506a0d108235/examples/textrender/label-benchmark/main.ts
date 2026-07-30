import {
  createLabel,
  getAnnotationSnapshot,
  invalidateAnnotation,
  updateLabel,
  updateAnnotationLayer,
  type AnnotationLayer,
  type LabelHandle,
  type ResolvableAnchor
} from "@litools/annotator";
import type {
  TextRendererAnnotationBackendStats,
  TextRendererLabelBackgroundMode
} from "@litools/annotator/textrender";
import type { TextDemoContext } from "../shared.js";

type Workload = "static" | "moving" | "numeric-text" | "collision-hide" | "backgrounds" | "appearance-churn";
type RunMode = "quick" | "thorough";

interface BenchmarkCase {
  readonly name: string;
  readonly count: number;
  readonly workload: Workload;
  readonly backgroundMode: TextRendererLabelBackgroundMode;
  readonly zBuckets: number;
}

interface Profile {
  readonly mode: RunMode;
  readonly settle: number;
  readonly warmup: number;
  readonly samples: number;
  readonly rounds: number;
}

interface TimingSummary {
  readonly mean: number;
  readonly p50: number;
  readonly p95: number;
  readonly p99: number;
  readonly max: number;
}

interface CounterSnapshot {
  readonly translationBatches: number;
  readonly translatedRuns: number;
  readonly translationFallbacks: number;
  readonly compatibleRunPatches: number;
  readonly patchedGlyphSlots: number;
  readonly runPatchFallbacks: number;
  readonly shapeHits: number;
  readonly shapeMisses: number;
  readonly evictions: number;
  readonly capacityMisses: number;
}

interface RoundResult {
  readonly round: number;
  readonly mutationMs: TimingSummary;
  readonly updateMs: TimingSummary;
  readonly combinedMs: TimingSummary;
  readonly frameCadenceMs: TimingSummary;
  readonly droppedFrames: { readonly over16_7: number; readonly over33_3: number };
  readonly backendWork: CounterSnapshot;
  readonly correctness: { readonly sampled: number; readonly rendered: number; readonly checksum: number };
}

interface CaseResult {
  readonly configuration: BenchmarkCase;
  readonly preparationMs: number;
  readonly rounds: readonly RoundResult[];
  readonly renderer: ReturnType<typeof rendererStats>;
}

interface ActiveRun {
  readonly profile: Profile;
  readonly startedAt: number;
  caseIndex: number;
  round: number;
  phase: "settle" | "warmup" | "sample";
  phaseFrame: number;
  workloadFrame: number;
  layer: AnnotationLayer;
  labels: LabelHandle[];
  anchors: Float32Array[];
  baseAnchors: Float32Array[];
  values: number[];
  preparationMs: number;
  baseline: CounterSnapshot;
  mutationSamples: number[];
  updateSamples: number[];
  combinedSamples: number[];
  frameSamples: number[];
  currentRounds: RoundResult[];
  results: CaseResult[];
}

const profiles: Record<RunMode, Profile> = {
  quick: { mode: "quick", settle: 5, warmup: 15, samples: 60, rounds: 1 },
  thorough: { mode: "thorough", settle: 15, warmup: 45, samples: 240, rounds: 3 }
};

const cases: readonly BenchmarkCase[] = [
  { name: "baseline-100", count: 100, workload: "static", backgroundMode: "nine-slice", zBuckets: 1 },
  { name: "baseline-500", count: 500, workload: "static", backgroundMode: "nine-slice", zBuckets: 1 },
  { name: "moving-500", count: 500, workload: "moving", backgroundMode: "nine-slice", zBuckets: 1 },
  { name: "moving-1000", count: 1_000, workload: "moving", backgroundMode: "nine-slice", zBuckets: 1 },
  { name: "numeric-churn-500", count: 500, workload: "numeric-text", backgroundMode: "nine-slice", zBuckets: 1 },
  { name: "collision-hide-500", count: 500, workload: "collision-hide", backgroundMode: "nine-slice", zBuckets: 1 },
  { name: "nine-slice-500", count: 500, workload: "backgrounds", backgroundMode: "nine-slice", zBuckets: 1 },
  { name: "rounded-card-500", count: 500, workload: "backgrounds", backgroundMode: "rounded-card", zBuckets: 1 },
  { name: "rounded-card-1000", count: 1_000, workload: "backgrounds", backgroundMode: "rounded-card", zBuckets: 1 },
  { name: "z-buckets-500", count: 500, workload: "moving", backgroundMode: "nine-slice", zBuckets: 4 },
  { name: "appearance-churn-500", count: 500, workload: "appearance-churn", backgroundMode: "nine-slice", zBuckets: 1 }
];

const colors = ["#5bf0bd", "#72e6ff", "#ffd166", "#ff8a65"] as const;

export function configureLabelBenchmark(context: TextDemoContext): void {
  context.panel.describe(
    "Deterministic TextRenderer label suite covering projection, translation, numeric shaping, collisions, backgrounds, z buckets, and bounded appearance-cache churn."
  );
  let active: ActiveRun | null = null;
  let reportJson = "";

  const quickButton = context.panel.button("Run quick suite", () => start("quick"));
  const thoroughButton = context.panel.button("Run thorough suite", () => start("thorough"));
  const stopButton = context.panel.button("Stop", stop);
  const copyButton = context.panel.button("Copy JSON", () => { void copyReport(); });
  stopButton.disabled = true;
  copyButton.disabled = true;

  context.frame((deltaMs) => {
    if (!active) return;
    const configuration = cases[active.caseIndex]!;
    const mutationStart = performance.now();
    mutate(active, configuration);
    const mutationMs = performance.now() - mutationStart;
    const updateStart = performance.now();
    updateAnnotationLayer(active.layer);
    const updateMs = performance.now() - updateStart;

    active.workloadFrame++;
    active.phaseFrame++;
    if (active.phase === "settle") {
      status(active);
      if (active.phaseFrame >= active.profile.settle) nextPhase(active, "warmup");
      return;
    }
    if (active.phase === "warmup") {
      status(active);
      if (active.phaseFrame >= active.profile.warmup) {
        active.baseline = counters(context.backend.getStats());
        nextPhase(active, "sample");
      }
      return;
    }

    active.mutationSamples.push(mutationMs);
    active.updateSamples.push(updateMs);
    active.combinedSamples.push(mutationMs + updateMs);
    active.frameSamples.push(deltaMs);
    status(active);
    if (active.phaseFrame >= active.profile.samples) finishRound(active);
  });

  function start(mode: RunMode): void {
    if (active) return;
    reportJson = "";
    const prepared = prepareCase(0);
    active = {
      profile: profiles[mode],
      startedAt: performance.now(),
      caseIndex: 0,
      round: 1,
      phase: "settle",
      phaseFrame: 0,
      workloadFrame: 0,
      ...prepared,
      baseline: counters(context.backend.getStats()),
      mutationSamples: [],
      updateSamples: [],
      combinedSamples: [],
      frameSamples: [],
      currentRounds: [],
      results: []
    };
    setRunning(true);
  }

  function prepareCase(caseIndex: number) {
    const configuration = cases[caseIndex]!;
    const layer = context.recreateLayer("public", "manual", configuration.backgroundMode);
    const labels: LabelHandle[] = [];
    const anchors: Float32Array[] = [];
    const baseAnchors: Float32Array[] = [];
    const values: number[] = [];
    const started = performance.now();
    for (let index = 0; index < configuration.count; index++) {
      const base = deterministicPosition(index, configuration.count);
      const position = new Float32Array(base);
      baseAnchors.push(base);
      anchors.push(position);
      values.push(index % 100);
      const anchor: ResolvableAnchor = {
        kind: "resolver",
        resolve(out) { out.set(position); return { available: true, targetVisible: true, position: out }; }
      };
      const background = configuration.workload === "backgrounds" || configuration.workload === "appearance-churn";
      labels.push(createLabel(layer, {
        anchor,
        text: () => configuration.workload === "numeric-text"
          ? `Sensor ${index % 50}: ${values[index]!.toFixed(1)}`
          : `L-${index % 100}`,
        collision: configuration.workload === "collision-hide" ? "hide" : "none",
        zIndex: index % configuration.zBuckets,
        style: {
          color: "#edf8f4",
          fontSize: 12,
          ...(background ? configuration.workload === "appearance-churn" ? appearanceStyle(0) : {
            backgroundColor: "#102b3de6",
            borderColor: colors[index % colors.length]!,
            borderWidth: 1,
            borderRadius: 6,
            padding: 4
          } : {})
        }
      }));
    }
    return { layer, labels, anchors, baseAnchors, values, preparationMs: performance.now() - started };
  }

  function mutate(run: ActiveRun, configuration: BenchmarkCase): void {
    if (configuration.workload === "static" || configuration.workload === "backgrounds" ||
        configuration.workload === "collision-hide") return;
    if (configuration.workload === "numeric-text") {
      for (let index = 0; index < run.labels.length; index++) {
        run.values[index] = (run.values[index]! + 0.1 + index % 7 * 0.01) % 100;
        invalidateAnnotation(run.labels[index]!);
      }
      return;
    }
    if (configuration.workload === "appearance-churn") {
      const index = run.workloadFrame % run.labels.length;
      updateLabel(run.labels[index]!, { style: { color: "#edf8f4", fontSize: 12, ...appearanceStyle(run.workloadFrame % 160) } });
      return;
    }
    const time = run.workloadFrame * 0.016;
    for (let index = 0; index < run.anchors.length; index++) {
      const base = run.baseAnchors[index]!;
      const position = run.anchors[index]!;
      position[0] = base[0]! + Math.sin(time * 0.7 + index * 0.13) * 0.08;
      position[1] = base[1]! + Math.cos(time * 0.9 + index * 0.17) * 0.05;
    }
  }

  function finishRound(run: ActiveRun): void {
    const now = counters(context.backend.getStats());
    run.currentRounds.push({
      round: run.round,
      mutationMs: summarize(run.mutationSamples),
      updateMs: summarize(run.updateSamples),
      combinedMs: summarize(run.combinedSamples),
      frameCadenceMs: summarize(run.frameSamples),
      droppedFrames: {
        over16_7: run.frameSamples.filter((value) => value > 16.7).length,
        over33_3: run.frameSamples.filter((value) => value > 33.3).length
      },
      backendWork: subtract(now, run.baseline),
      correctness: checksum(run.labels)
    });
    if (run.round < run.profile.rounds) {
      run.round++;
      resetRound(run);
      return;
    }
    run.results.push({
      configuration: cases[run.caseIndex]!,
      preparationMs: run.preparationMs,
      rounds: run.currentRounds,
      renderer: rendererStats(context.backend.getStats())
    });
    run.caseIndex++;
    if (run.caseIndex >= cases.length) {
      finishRun(run);
      return;
    }
    Object.assign(run, prepareCase(run.caseIndex));
    run.round = 1;
    run.currentRounds = [];
    resetRound(run);
  }

  function resetRound(run: ActiveRun): void {
    run.phase = "settle";
    run.phaseFrame = 0;
    run.workloadFrame = 0;
    run.mutationSamples = [];
    run.updateSamples = [];
    run.combinedSamples = [];
    run.frameSamples = [];
    run.baseline = counters(context.backend.getStats());
  }

  function nextPhase(run: ActiveRun, phase: ActiveRun["phase"]): void {
    run.phase = phase;
    run.phaseFrame = 0;
  }

  function finishRun(run: ActiveRun): void {
    reportJson = JSON.stringify({
      benchmark: "annotator-textrender-label-suite",
      workloadVersion: 3,
      timestamp: new Date().toISOString(),
      environment: {
        userAgent: navigator.userAgent,
        hardwareConcurrency: navigator.hardwareConcurrency,
        deviceMemoryGiB: (navigator as Navigator & { deviceMemory?: number }).deviceMemory ?? null,
        devicePixelRatio: window.devicePixelRatio,
        viewportCss: { width: context.canvas.clientWidth, height: context.canvas.clientHeight }
      },
      profile: run.profile,
      elapsedMs: performance.now() - run.startedAt,
      timingScope: {
        mutation: "application-side anchor/text changes",
        update: "updateAnnotationLayer only; excludes rendering",
        frameCadence: "Lite onBeforeRender delta"
      },
      results: run.results
    }, null, 2);
    active = null;
    setRunning(false);
    copyButton.disabled = false;
    context.panel.status(`complete · ${run.profile.mode} · ${cases.length} cases · JSON ready`);
  }

  function stop(): void {
    active = null;
    setRunning(false);
    context.panel.status("stopped · partial results discarded");
  }

  function setRunning(running: boolean): void {
    quickButton.disabled = running;
    thoroughButton.disabled = running;
    stopButton.disabled = !running;
    copyButton.disabled = running || !reportJson;
  }

  function status(run: ActiveRun): void {
    const configuration = cases[run.caseIndex]!;
    const total = run.phase === "settle" ? run.profile.settle :
      run.phase === "warmup" ? run.profile.warmup : run.profile.samples;
    context.panel.status(
      `${run.profile.mode} · case ${run.caseIndex + 1}/${cases.length} ${configuration.name} · ` +
      `round ${run.round}/${run.profile.rounds} · ${run.phase} ${run.phaseFrame}/${total}`
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

function deterministicPosition(index: number, count: number): Float32Array {
  const golden = index * 2.399963229728653;
  const radius = 0.35 + Math.sqrt((index + 0.5) / count) * 5.5;
  return new Float32Array([
    Math.cos(golden) * radius,
    Math.sin(index * 1.61803398875) * 2.5,
    Math.sin(golden) * radius
  ]);
}

function appearanceStyle(index: number) {
  const fill = dynamicColor(index * 2 + 17, 0xcc);
  const border = dynamicColor(index * 2 + 41, 0xff);
  return {
    backgroundColor: fill,
    borderColor: border,
    borderWidth: 1 + index % 2,
    borderRadius: 2 + index % 6,
    padding: 4
  };
}

function dynamicColor(seed: number, alpha: number): string {
  const value = Math.imul(seed + 1, 0x45d9f3b) >>> 0;
  return `#${(value & 0xffffff).toString(16).padStart(6, "0")}${alpha.toString(16).padStart(2, "0")}`;
}

function summarize(values: readonly number[]): TimingSummary {
  const sorted = [...values].sort((a, b) => a - b);
  const mean = values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
  return {
    mean,
    p50: percentile(sorted, 0.5),
    p95: percentile(sorted, 0.95),
    p99: percentile(sorted, 0.99),
    max: sorted.at(-1) ?? 0
  };
}

function percentile(sorted: readonly number[], fraction: number): number {
  if (sorted.length === 0) return 0;
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * fraction) - 1)]!;
}

function counters(stats: TextRendererAnnotationBackendStats): CounterSnapshot {
  return {
    translationBatches: stats.labelTranslationBatches,
    translatedRuns: stats.translatedLabelRuns,
    translationFallbacks: stats.labelTranslationFallbacks,
    compatibleRunPatches: stats.compatibleLabelRunPatches,
    patchedGlyphSlots: stats.patchedLabelGlyphSlots,
    runPatchFallbacks: stats.labelRunPatchFallbacks,
    shapeHits: stats.cacheHits,
    shapeMisses: stats.cacheMisses,
    evictions: stats.evictions,
    capacityMisses: stats.capacityMisses
  };
}

function subtract(current: CounterSnapshot, baseline: CounterSnapshot): CounterSnapshot {
  return {
    translationBatches: current.translationBatches - baseline.translationBatches,
    translatedRuns: current.translatedRuns - baseline.translatedRuns,
    translationFallbacks: current.translationFallbacks - baseline.translationFallbacks,
    compatibleRunPatches: current.compatibleRunPatches - baseline.compatibleRunPatches,
    patchedGlyphSlots: current.patchedGlyphSlots - baseline.patchedGlyphSlots,
    runPatchFallbacks: current.runPatchFallbacks - baseline.runPatchFallbacks,
    shapeHits: current.shapeHits - baseline.shapeHits,
    shapeMisses: current.shapeMisses - baseline.shapeMisses,
    evictions: current.evictions - baseline.evictions,
    capacityMisses: current.capacityMisses - baseline.capacityMisses
  };
}

function checksum(labels: readonly LabelHandle[]) {
  const sampled = Math.min(32, labels.length);
  let rendered = 0;
  let checksumValue = 2166136261;
  for (let sample = 0; sample < sampled; sample++) {
    const index = Math.min(labels.length - 1, Math.floor(sample * labels.length / sampled));
    const snapshot = getAnnotationSnapshot(labels[index]!);
    if (snapshot.rendered) rendered++;
    checksumValue = Math.imul(checksumValue ^ Math.round((snapshot.bounds?.x ?? -1) * 10), 16777619);
    checksumValue = Math.imul(checksumValue ^ Math.round((snapshot.bounds?.y ?? -1) * 10), 16777619);
  }
  return { sampled, rendered, checksum: checksumValue >>> 0 };
}

function rendererStats(stats: TextRendererAnnotationBackendStats) {
  return {
    backgroundMode: stats.labelBackgroundMode,
    liveLabels: stats.liveLabels,
    textBuckets: stats.textBuckets,
    textDrawCalls: stats.textDrawCalls,
    labelBackgroundSprites: stats.labelBackgroundSprites,
    labelBackgroundDrawCalls: stats.labelBackgroundDrawCalls,
    roundedCardLayers: stats.roundedCardLayers,
    roundedCardDrawCalls: stats.roundedCardDrawCalls,
    installedGlyphs: stats.installedGlyphs,
    glyphUploadBatches: stats.glyphUploadBatches,
    colorCacheEntries: stats.colorCacheEntries,
    markerFrameCacheEntries: stats.markerFrameCacheEntries,
    backgroundFrameCacheEntries: stats.backgroundFrameCacheEntries,
    atlasFrames: stats.atlasFrames,
    atlasBytes: stats.atlasBytes,
    evictions: stats.evictions,
    capacityMisses: stats.capacityMisses
  };
}
