export interface ArenaBenchmarkCounters {
  readonly flushes: number;
  readonly cpuDirtyBytes: number;
  readonly backendUploadCalls: number;
  readonly backendBytesUploaded: number;
  readonly backingAllocations: number;
}

export type ArenaBenchmarkPopulation = 100 | 500 | 1000 | 1500 | 2000 | 2500;
export const ARENA_BENCHMARK_RELIABILITY_DRIFT_PERCENT = 15;

export interface ArenaBenchmarkFrame {
  readonly frameMs: number;
  readonly updateMs: number;
  readonly gpuMs: number;
  readonly drawCalls: number;
}

export interface ArenaBenchmarkPhaseResult {
  readonly durationMs: number;
  readonly frames: number;
  readonly frameP50Ms: number;
  readonly frameP95Ms: number;
  readonly updateP50Ms: number;
  readonly updateP95Ms: number;
  readonly gpuP50Ms: number;
  readonly gpuP95Ms: number;
  readonly averageDrawCalls: number;
  readonly playbackMutationCount: number;
  readonly playbackMutationP50Ms: number;
  readonly playbackMutationP95Ms: number;
  readonly uploads: ArenaBenchmarkCounters;
  readonly heapDeltaBytes: number | undefined;
}

export interface ArenaGeometryWorkload {
  readonly sourceMeshParts: number;
  readonly renderedMeshInstances: number;
  readonly renderedVertices: number;
  readonly renderedTriangles: number;
}

export interface ArenaPopulationBenchmarkResult {
  readonly population: ArenaBenchmarkPopulation;
  readonly populationApplyMs: number;
  readonly visibleCount: number;
  readonly geometry: ArenaGeometryWorkload;
  readonly steady: ArenaBenchmarkPhaseResult;
  readonly reaction: ArenaBenchmarkPhaseResult;
  readonly passed: boolean;
  readonly sampleCount: number;
  readonly frameP95DriftPercent: number;
  readonly gpuP95DriftPercent: number | undefined;
  readonly reliable: boolean;
}

export interface ArenaBenchmarkPassResult {
  readonly iteration: number;
  readonly direction: "ascending" | "descending";
  readonly results: readonly ArenaPopulationBenchmarkResult[];
}

export interface ArenaBenchmarkBaseline {
  readonly frameP95Ms: number;
  readonly gpuP95Ms: number;
}

export interface ArenaBenchmarkRecoveryResult {
  readonly afterPopulation: ArenaBenchmarkPopulation;
  readonly passIteration: number;
  readonly durationMs: number;
  readonly gpuP95Ms: number;
  readonly recovered: boolean;
}

export interface ArenaBenchmarkReport {
  readonly schemaVersion: 6;
  readonly timestamp: string;
  readonly environment: {
    readonly userAgent: string;
    readonly hardwareConcurrency: number;
    readonly renderingBackend: string;
    readonly gpuTimingSupported: boolean;
  };
  readonly settings: {
    readonly mode: "quick" | "stress";
    readonly warmupMs: number;
    readonly steadyMs: number;
    readonly reactionMs: number;
    readonly reactionTimeScale: number;
    readonly populationCooldownMs: number;
    readonly baselineMs: number;
    readonly recoverySettleMs: number;
    readonly recoveryWindowMs: number;
    readonly recoveryMaxMs: number;
    readonly recoveryTolerancePercent: number;
    readonly reliabilityDriftPercent: number;
    readonly passCount: number;
    readonly populations: readonly ArenaBenchmarkPopulation[];
  };
  readonly completed: boolean;
  readonly stopReason?: string;
  readonly baseline: ArenaBenchmarkBaseline;
  /** Median results used by the benchmark panel. */
  readonly results: readonly ArenaPopulationBenchmarkResult[];
  /** Raw order-dependent measurements retained for diagnosing drift and throttling. */
  readonly passes: readonly ArenaBenchmarkPassResult[];
  readonly recoveries: readonly ArenaBenchmarkRecoveryResult[];
}

export function serializeArenaBenchmarkReport(report: ArenaBenchmarkReport): string {
  return JSON.stringify(report, null, 2);
}

export function summarizeArenaBenchmarkPhase(options: {
  durationMs: number;
  frames: readonly ArenaBenchmarkFrame[];
  playbackMutations: readonly number[];
  countersBefore: ArenaBenchmarkCounters;
  countersAfter: ArenaBenchmarkCounters;
  heapBefore?: number;
  heapAfter?: number;
}): ArenaBenchmarkPhaseResult {
  const frameTimes = options.frames.map((sample) => sample.frameMs);
  const updateTimes = options.frames.map((sample) => sample.updateMs);
  const gpuTimes = options.frames.map((sample) => sample.gpuMs).filter((value) => value > 0);
  return {
    durationMs: options.durationMs,
    frames: options.frames.length,
    frameP50Ms: percentile(frameTimes, 0.5),
    frameP95Ms: percentile(frameTimes, 0.95),
    updateP50Ms: percentile(updateTimes, 0.5),
    updateP95Ms: percentile(updateTimes, 0.95),
    gpuP50Ms: percentile(gpuTimes, 0.5),
    gpuP95Ms: percentile(gpuTimes, 0.95),
    averageDrawCalls: average(options.frames.map((sample) => sample.drawCalls)),
    playbackMutationCount: options.playbackMutations.length,
    playbackMutationP50Ms: percentile(options.playbackMutations, 0.5),
    playbackMutationP95Ms: percentile(options.playbackMutations, 0.95),
    uploads: subtractCounters(options.countersAfter, options.countersBefore),
    heapDeltaBytes:
      options.heapBefore === undefined || options.heapAfter === undefined
        ? undefined
        : options.heapAfter - options.heapBefore
  };
}

export function aggregateArenaPopulationResults(
  samples: readonly ArenaPopulationBenchmarkResult[]
): ArenaPopulationBenchmarkResult {
  const first = samples[0];
  if (!first) throw new Error("At least one population benchmark sample is required.");
  if (samples.some((sample) => sample.population !== first.population)) {
    throw new Error("Population benchmark samples must target the same population.");
  }
  const frameP95DriftPercent = Math.max(
    driftPercent(samples.map((sample) => sample.steady.frameP95Ms)) ?? 0,
    driftPercent(samples.map((sample) => sample.reaction.frameP95Ms)) ?? 0
  );
  const gpuDrifts = [
    driftPercent(samples.map((sample) => sample.steady.gpuP95Ms)),
    driftPercent(samples.map((sample) => sample.reaction.gpuP95Ms))
  ].filter((value): value is number => value !== undefined);
  const gpuP95DriftPercent = gpuDrifts.length > 0 ? Math.max(...gpuDrifts) : undefined;
  return {
    population: first.population,
    populationApplyMs: median(samples.map((sample) => sample.populationApplyMs)),
    visibleCount: median(samples.map((sample) => sample.visibleCount)),
    geometry: {
      sourceMeshParts: median(samples.map((sample) => sample.geometry.sourceMeshParts)),
      renderedMeshInstances: median(samples.map((sample) => sample.geometry.renderedMeshInstances)),
      renderedVertices: median(samples.map((sample) => sample.geometry.renderedVertices)),
      renderedTriangles: median(samples.map((sample) => sample.geometry.renderedTriangles))
    },
    steady: aggregatePhases(samples.map((sample) => sample.steady)),
    reaction: aggregatePhases(samples.map((sample) => sample.reaction)),
    passed: samples.every((sample) => sample.passed),
    sampleCount: samples.length,
    frameP95DriftPercent,
    gpuP95DriftPercent,
    reliable:
      samples.length >= 2 &&
      frameP95DriftPercent <= ARENA_BENCHMARK_RELIABILITY_DRIFT_PERCENT &&
      (gpuP95DriftPercent === undefined || gpuP95DriftPercent <= ARENA_BENCHMARK_RELIABILITY_DRIFT_PERCENT)
  };
}

export function percentile(samples: readonly number[], fraction: number): number {
  if (samples.length === 0) return 0;
  const sorted = [...samples].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * fraction))] ?? 0;
}

function subtractCounters(after: ArenaBenchmarkCounters, before: ArenaBenchmarkCounters): ArenaBenchmarkCounters {
  return {
    flushes: after.flushes - before.flushes,
    cpuDirtyBytes: after.cpuDirtyBytes - before.cpuDirtyBytes,
    backendUploadCalls: after.backendUploadCalls - before.backendUploadCalls,
    backendBytesUploaded: after.backendBytesUploaded - before.backendBytesUploaded,
    backingAllocations: after.backingAllocations - before.backingAllocations
  };
}

function average(samples: readonly number[]): number {
  return samples.length === 0 ? 0 : samples.reduce((total, value) => total + value, 0) / samples.length;
}

function aggregatePhases(samples: readonly ArenaBenchmarkPhaseResult[]): ArenaBenchmarkPhaseResult {
  return {
    durationMs: median(samples.map((sample) => sample.durationMs)),
    frames: median(samples.map((sample) => sample.frames)),
    frameP50Ms: median(samples.map((sample) => sample.frameP50Ms)),
    frameP95Ms: median(samples.map((sample) => sample.frameP95Ms)),
    updateP50Ms: median(samples.map((sample) => sample.updateP50Ms)),
    updateP95Ms: median(samples.map((sample) => sample.updateP95Ms)),
    gpuP50Ms: median(samples.map((sample) => sample.gpuP50Ms)),
    gpuP95Ms: median(samples.map((sample) => sample.gpuP95Ms)),
    averageDrawCalls: median(samples.map((sample) => sample.averageDrawCalls)),
    playbackMutationCount: median(samples.map((sample) => sample.playbackMutationCount)),
    playbackMutationP50Ms: median(samples.map((sample) => sample.playbackMutationP50Ms)),
    playbackMutationP95Ms: median(samples.map((sample) => sample.playbackMutationP95Ms)),
    uploads: {
      flushes: median(samples.map((sample) => sample.uploads.flushes)),
      cpuDirtyBytes: median(samples.map((sample) => sample.uploads.cpuDirtyBytes)),
      backendUploadCalls: median(samples.map((sample) => sample.uploads.backendUploadCalls)),
      backendBytesUploaded: median(samples.map((sample) => sample.uploads.backendBytesUploaded)),
      backingAllocations: median(samples.map((sample) => sample.uploads.backingAllocations))
    },
    heapDeltaBytes: medianOptional(samples.map((sample) => sample.heapDeltaBytes))
  };
}

function median(samples: readonly number[]): number {
  if (samples.length === 0) return 0;
  const sorted = [...samples].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2
    : sorted[middle] ?? 0;
}

function medianOptional(samples: readonly (number | undefined)[]): number | undefined {
  const available = samples.filter((sample): sample is number => sample !== undefined);
  return available.length === samples.length ? median(available) : undefined;
}

function driftPercent(samples: readonly number[]): number | undefined {
  const available = samples.filter((sample) => sample > 0 && Number.isFinite(sample));
  if (available.length !== samples.length || available.length < 2) return undefined;
  const minimum = Math.min(...available);
  const maximum = Math.max(...available);
  return ((maximum - minimum) / minimum) * 100;
}
