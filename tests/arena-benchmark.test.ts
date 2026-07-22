import {
  aggregateArenaPopulationResults,
  serializeArenaBenchmarkReport,
  summarizeArenaBenchmarkPhase
} from "../examples/massive-avatar-arena/src/benchmark.js";

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
      countersBefore: { flushes: 10, cpuDirtyBytes: 100, backendUploadCalls: 5, backendBytesUploaded: 1000, backingAllocations: 2 },
      countersAfter: { flushes: 14, cpuDirtyBytes: 180, backendUploadCalls: 8, backendBytesUploaded: 1400, backingAllocations: 2 },
      heapBefore: 1000,
      heapAfter: 1250
    });
    expect(result).toMatchObject({
      frameP50Ms: 20,
      frameP95Ms: 20,
      updateP50Ms: 2,
      playbackMutationP95Ms: 0.2,
      averageDrawCalls: 4,
      uploads: { flushes: 4, cpuDirtyBytes: 80, backendUploadCalls: 3, backendBytesUploaded: 400, backingAllocations: 0 },
      heapDeltaBytes: 250
    });
  });

  it("serializes a copyable report as formatted JSON", () => {
    const text = serializeArenaBenchmarkReport({
      schemaVersion: 6,
      timestamp: "2026-07-21T00:00:00.000Z",
      environment: { userAgent: "test", hardwareConcurrency: 8, renderingBackend: "webgpu", gpuTimingSupported: true },
      settings: {
        mode: "quick",
        warmupMs: 500,
        steadyMs: 1000,
        reactionMs: 3000,
        reactionTimeScale: 3,
        populationCooldownMs: 750,
        baselineMs: 1500,
        recoverySettleMs: 1000,
        recoveryWindowMs: 1000,
        recoveryMaxMs: 15000,
        recoveryTolerancePercent: 10,
        reliabilityDriftPercent: 15,
        passCount: 1,
        populations: [100, 500, 1000, 1500]
      },
      completed: true,
      baseline: { frameP95Ms: 16.7, gpuP95Ms: 5 },
      results: [],
      passes: [],
      recoveries: []
    });

    expect(text).toContain('\n  "schemaVersion": 6');
    expect(JSON.parse(text)).toMatchObject({ schemaVersion: 6, completed: true, results: [], passes: [], recoveries: [] });
  });

  it("aggregates ascending and descending population samples by median", () => {
    const phase = (frameP95Ms: number) => ({
      durationMs: 3000,
      frames: 180,
      frameP50Ms: frameP95Ms,
      frameP95Ms,
      updateP50Ms: 0.2,
      updateP95Ms: 0.3,
      gpuP50Ms: 10,
      gpuP95Ms: 12,
      averageDrawCalls: 35,
      playbackMutationCount: 500,
      playbackMutationP50Ms: 0.1,
      playbackMutationP95Ms: 0.2,
      uploads: { flushes: 10, cpuDirtyBytes: 20, backendUploadCalls: 30, backendBytesUploaded: 40, backingAllocations: 0 },
      heapDeltaBytes: 100
    });
    const common = {
      population: 100 as const,
      populationApplyMs: 2,
      visibleCount: 100,
      geometry: { sourceMeshParts: 4, renderedMeshInstances: 120, renderedVertices: 1000, renderedTriangles: 500 },
      passed: true,
      sampleCount: 1,
      frameP95DriftPercent: 0,
      gpuP95DriftPercent: undefined,
      reliable: true
    };
    const result = aggregateArenaPopulationResults([
      { ...common, steady: phase(16), reaction: phase(20) },
      { ...common, steady: phase(20), reaction: phase(30) },
      { ...common, steady: phase(50), reaction: phase(70) }
    ]);

    expect(result.steady.frameP95Ms).toBe(20);
    expect(result.reaction.frameP95Ms).toBe(30);
    expect(result.geometry.renderedVertices).toBe(1000);
    expect(result.sampleCount).toBe(3);
    expect(result.frameP95DriftPercent).toBe(250);
    expect(result.reliable).toBe(false);
  });

  it("does not claim repeatability from one quick sample", () => {
    const phase = {
      durationMs: 1000,
      frames: 60,
      frameP50Ms: 16,
      frameP95Ms: 17,
      updateP50Ms: 0.1,
      updateP95Ms: 0.2,
      gpuP50Ms: 10,
      gpuP95Ms: 11,
      averageDrawCalls: 35,
      playbackMutationCount: 0,
      playbackMutationP50Ms: 0,
      playbackMutationP95Ms: 0,
      uploads: { flushes: 0, cpuDirtyBytes: 0, backendUploadCalls: 0, backendBytesUploaded: 0, backingAllocations: 0 },
      heapDeltaBytes: 0
    };
    const result = aggregateArenaPopulationResults([{
      population: 100,
      populationApplyMs: 1,
      visibleCount: 100,
      geometry: { sourceMeshParts: 6, renderedMeshInstances: 142, renderedVertices: 1, renderedTriangles: 1 },
      steady: phase,
      reaction: phase,
      passed: true,
      sampleCount: 1,
      frameP95DriftPercent: 0,
      gpuP95DriftPercent: undefined,
      reliable: false
    }]);

    expect(result.sampleCount).toBe(1);
    expect(result.reliable).toBe(false);
  });
});
