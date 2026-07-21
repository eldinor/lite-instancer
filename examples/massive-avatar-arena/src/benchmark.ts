export interface ArenaBenchmarkCounters {
  readonly flushes: number;
  readonly cpuDirtyBytes: number;
  readonly backendUploadCalls: number;
  readonly backendBytesUploaded: number;
  readonly backingAllocations: number;
}

export type ArenaBenchmarkPopulation = 100 | 500 | 1000 | 1500 | 2500;

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

export interface ArenaPopulationBenchmarkResult {
  readonly population: ArenaBenchmarkPopulation;
  readonly populationApplyMs: number;
  readonly visibleCount: number;
  readonly steady: ArenaBenchmarkPhaseResult;
  readonly reaction: ArenaBenchmarkPhaseResult;
  readonly passed: boolean;
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
