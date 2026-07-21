import { summarizeArenaBenchmarkPhase } from "../examples/massive-avatar-arena/src/benchmark.js";

describe("Avatar Arena benchmark aggregation", () => {
  it("produces deterministic percentiles and counter deltas", () => {
    const result = summarizeArenaBenchmarkPhase({
      durationMs: 3000,
      frames: [
        { frameMs: 10, updateMs: 1, gpuMs: 4, drawCalls: 3 },
        { frameMs: 20, updateMs: 2, gpuMs: 6, drawCalls: 5 },
        { frameMs: 30, updateMs: 3, gpuMs: 8, drawCalls: 4 }
      ],
      playbackMutations: [0.1, 0.3, 0.2],
      countersBefore: { flushes: 10, cpuDirtyBytes: 100, estimatedGpuBytes: 1000, backingAllocations: 2 },
      countersAfter: { flushes: 14, cpuDirtyBytes: 180, estimatedGpuBytes: 1400, backingAllocations: 2 },
      heapBefore: 1000,
      heapAfter: 1250
    });
    expect(result).toMatchObject({
      frameP50Ms: 20,
      frameP95Ms: 20,
      updateP50Ms: 2,
      playbackMutationP95Ms: 0.2,
      averageDrawCalls: 4,
      uploads: { flushes: 4, cpuDirtyBytes: 80, estimatedGpuBytes: 400, backingAllocations: 0 },
      heapDeltaBytes: 250
    });
  });
});
