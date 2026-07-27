import {
  createLabel,
  createMarker,
  setAnnotationVisible,
  updateAnnotationLayer,
  updateMarker,
  type MarkerHandle,
  type MarkerShape
} from "@litools/annotator";
import {
  createAnnotationInteractionManager,
  disposeAnnotationInteractionManager,
  getAnnotationInteractionDiagnostics,
  onAnnotationInteractionEvent,
  pickInteractiveAnnotation,
  registerInteractiveAnnotation,
  type AnnotationInteractionManager
} from "@litools/annotator/interaction";
import type { TextDemoContext } from "../shared.js";

const QUERY_COUNT = 20_000;
const QUERY_BATCH = 100;
const WARMUP_QUERY_COUNT = 5_000;
const ROUND_COUNT = 3;
const PARTIAL_MOVE_FRACTION = 0.01;
const benchmarkCounts = [100, 1_000, 10_000] as const;
const shapes: readonly MarkerShape[] = ["dot", "square", "diamond", "triangle", "ring"];
const colors = ["#5bf0bd", "#72e6ff", "#ffd166", "#ff8a65"] as const;

export function configureGpuInteraction(context: TextDemoContext): void {
  context.panel.describe("Hover and click GPU annotations. The CPU spatial index follows final collision/projection bounds without GPU readback or public snapshot allocation. Run the automatic query benchmark on demand.");
  const manager = createAnnotationInteractionManager({
    layer: context.layer,
    canvas: context.canvas,
    cellSize: 64,
    hitSlop: 2,
    onError(error) { context.panel.status(`interaction error: ${String(error)}`); }
  });
  const markers: MarkerHandle[] = [];
  let selected: MarkerHandle | null = null;
  let reportJson = "";
  let benchmarkRunning = false;

  const labelPositions = [[-3.5, 2.5, 0], [0, 2.8, 0], [3.5, 2.5, 0]] as const;
  for (const [index, position] of labelPositions.entries()) {
    const label = createLabel(context.layer, {
      anchor: { kind: "world", position },
      text: ["Interactive label", "Spatial CPU index", "Click a marker"][index]!,
      zIndex: 20,
      style: { color: ["#5bf0bd", "#ffffff", "#72e6ff"][index]!, fontSize: 22 }
    });
    registerInteractiveAnnotation(manager, label, { hitSlop: 6 });
  }

  ensureMarkers(250);
  updateAnnotationLayer(context.layer);

  onAnnotationInteractionEvent(manager, "hoverstart", (event) => {
    context.canvas.style.cursor = "pointer";
    context.panel.status(`hover · ${event.annotation.type} #${event.annotation.id}`);
  });
  onAnnotationInteractionEvent(manager, "hoverend", () => {
    context.canvas.style.cursor = "default";
  });
  onAnnotationInteractionEvent(manager, "click", (event) => {
    if (event.annotation.type === "marker") selectMarker(event.annotation as MarkerHandle);
    context.panel.status(`selected · ${event.annotation.type} #${event.annotation.id}`);
  });

  const runButton = context.panel.button("Run 100–10,000 picking benchmark", () => { void runBenchmark(); });
  const copyButton = context.panel.button("Copy JSON", () => { void copyReport(); });
  copyButton.disabled = true;

  window.addEventListener("beforeunload", () => disposeAnnotationInteractionManager(manager), { once: true });

  function ensureMarkers(count: number): void {
    for (let index = markers.length; index < count; index++) {
      const x = (((index * 0.61803398875) % 1) - 0.5) * 11;
      const y = (((index * 0.41421356237) % 1) - 0.5) * 5.2 - 0.3;
      const z = Math.sin(index * 0.37) * 0.7;
      const marker = createMarker(context.layer, {
        anchor: { kind: "world", position: [x, y, z] },
        shape: shapes[index % shapes.length]!,
        size: 12,
        zIndex: index % 3,
        style: { backgroundColor: colors[index % colors.length]!, borderColor: "#06110e", borderWidth: 1 }
      });
      markers.push(marker);
      registerInteractiveAnnotation(manager, marker);
    }
  }

  function selectMarker(marker: MarkerHandle): void {
    if (selected && selected !== marker) {
      const index = markers.indexOf(selected);
      updateMarker(selected, {
        size: 12,
        style: { backgroundColor: colors[Math.max(0, index) % colors.length]!, borderColor: "#06110e", borderWidth: 1 }
      });
    }
    selected = marker;
    updateMarker(marker, {
      size: 18,
      style: { backgroundColor: "#ffffff", borderColor: "#00d99b", borderWidth: 3 }
    });
  }

  async function runBenchmark(): Promise<void> {
    if (benchmarkRunning) return;
    benchmarkRunning = true;
    runButton.disabled = true;
    copyButton.disabled = true;
    reportJson = "";
    const startedAt = performance.now();
    const results: object[] = [];
    const cellSizeSweep: object[] = [];
    try {
      for (const count of benchmarkCounts) {
        context.panel.status(`preparing ${count.toLocaleString()} interactive markers`);
        await nextFrame();
        const preparationStartedAt = performance.now();
        ensureMarkers(count);
        for (let index = 0; index < markers.length; index++) {
          setAnnotationVisible(markers[index]!, index < count);
        }
        updateAnnotationLayer(context.layer);
        const preparationCpuMs = performance.now() - preparationStartedAt;

        const indexStartedAt = performance.now();
        const indexed = getAnnotationInteractionDiagnostics(manager);
        const indexBuildCpuMs = performance.now() - indexStartedAt;

        context.panel.status(`warming up ${count.toLocaleString()}-target queries`);
        runQueries(manager, context.canvas.clientWidth, context.canvas.clientHeight, WARMUP_QUERY_COUNT, count, "viewport");
        runQueries(manager, context.canvas.clientWidth, context.canvas.clientHeight, WARMUP_QUERY_COUNT, count, "center");
        const viewportRounds = [];
        const centerRounds = [];
        for (let round = 0; round < ROUND_COUNT; round++) {
          await nextFrame();
          viewportRounds.push(runQueries(
            manager,
            context.canvas.clientWidth,
            context.canvas.clientHeight,
            QUERY_COUNT,
            count * 10 + round * QUERY_COUNT,
            "viewport"
          ));
          centerRounds.push(runQueries(
            manager,
            context.canvas.clientWidth,
            context.canvas.clientHeight,
            QUERY_COUNT,
            count * 20 + round * QUERY_COUNT,
            "center"
          ));
        }

        context.camera.alpha += 0.01;
        const beforeCameraMove = getAnnotationInteractionDiagnostics(manager);
        const movingUpdateStartedAt = performance.now();
        updateAnnotationLayer(context.layer);
        const movingAnnotationUpdateCpuMs = performance.now() - movingUpdateStartedAt;
        const movingIndexStartedAt = performance.now();
        const moved = getAnnotationInteractionDiagnostics(manager);
        const movingIndexBuildCpuMs = performance.now() - movingIndexStartedAt;

        const partialCount = Math.max(1, Math.floor(count * PARTIAL_MOVE_FRACTION));
        const beforePartialMove = getAnnotationInteractionDiagnostics(manager);
        const partialUpdateStartedAt = performance.now();
        for (let index = 0; index < partialCount; index++) {
          updateMarker(markers[index * Math.max(1, Math.floor(count / partialCount))]!, { screenOffset: [2, 0] });
        }
        updateAnnotationLayer(context.layer);
        const partialAnnotationUpdateCpuMs = performance.now() - partialUpdateStartedAt;
        const partialIndexStartedAt = performance.now();
        const partiallyMoved = getAnnotationInteractionDiagnostics(manager);
        const partialIndexSyncCpuMs = performance.now() - partialIndexStartedAt;

        results.push({
          configuration: {
            markers: count,
            labels: 3,
            queriesPerRound: QUERY_COUNT,
            warmupQueries: WARMUP_QUERY_COUNT,
            rounds: ROUND_COUNT,
            cellSize: 64,
            hitSlop: 2
          },
          preparationCpuMs,
          staticIndexBuildCpuMs: indexBuildCpuMs,
          queryWorkloads: {
            viewport: { rounds: viewportRounds, median: summarizeRounds(viewportRounds) },
            centerDense: { rounds: centerRounds, median: summarizeRounds(centerRounds) }
          },
          index: {
            indexedTargets: indexed.indexedTargets,
            gridCells: indexed.gridCells,
            lifetimeMaximumCandidates: moved.maximumCandidates
          },
          cameraMove: {
            annotationUpdateCpuMs: movingAnnotationUpdateCpuMs,
            indexSyncCpuMs: movingIndexBuildCpuMs,
            fullRebuilds: moved.indexRebuilds - beforeCameraMove.indexRebuilds,
            incrementalTargetUpdates: moved.incrementalIndexUpdates - beforeCameraMove.incrementalIndexUpdates,
            regionUpdates: moved.regionUpdates - beforeCameraMove.regionUpdates
          },
          partialMove: {
            requestedTargets: partialCount,
            annotationUpdateCpuMs: partialAnnotationUpdateCpuMs,
            indexSyncCpuMs: partialIndexSyncCpuMs,
            fullRebuilds: partiallyMoved.indexRebuilds - beforePartialMove.indexRebuilds,
            incrementalTargetUpdates: partiallyMoved.incrementalIndexUpdates - beforePartialMove.incrementalIndexUpdates,
            regionUpdates: partiallyMoved.regionUpdates - beforePartialMove.regionUpdates
          }
        });

        for (let index = 0; index < partialCount; index++) {
          updateMarker(markers[index * Math.max(1, Math.floor(count / partialCount))]!, { screenOffset: [0, 0] });
        }
        updateAnnotationLayer(context.layer);
      }

      for (const cellSize of [32, 64, 128] as const) {
        context.panel.status(`comparing ${cellSize}px spatial cells at 10,000 markers`);
        await nextFrame();
        const registrationStartedAt = performance.now();
        const comparisonManager = createAnnotationInteractionManager({
          layer: context.layer,
          canvas: context.canvas,
          cellSize,
          hitSlop: 2,
          hover: false
        });
        try {
          for (const marker of markers) registerInteractiveAnnotation(comparisonManager, marker);
          const registrationCpuMs = performance.now() - registrationStartedAt;
          const indexStartedAt = performance.now();
          const indexed = getAnnotationInteractionDiagnostics(comparisonManager);
          const indexBuildCpuMs = performance.now() - indexStartedAt;
          runQueries(
            comparisonManager,
            context.canvas.clientWidth,
            context.canvas.clientHeight,
            WARMUP_QUERY_COUNT,
            cellSize,
            "center"
          );
          const rounds = [];
          for (let round = 0; round < ROUND_COUNT; round++) {
            rounds.push(runQueries(
              comparisonManager,
              context.canvas.clientWidth,
              context.canvas.clientHeight,
              QUERY_COUNT,
              cellSize * 100 + round * QUERY_COUNT,
              "center"
            ));
          }
          cellSizeSweep.push({
            cellSize,
            registrationCpuMs,
            indexBuildCpuMs,
            indexedTargets: indexed.indexedTargets,
            gridCells: indexed.gridCells,
            rounds,
            median: summarizeRounds(rounds)
          });
        } finally {
          disposeAnnotationInteractionManager(comparisonManager);
        }
      }

      reportJson = JSON.stringify({
        benchmark: "annotator-cpu-spatial-picking",
        workloadVersion: 2,
        timestamp: new Date().toISOString(),
        environment: {
          userAgent: navigator.userAgent,
          devicePixelRatio: window.devicePixelRatio,
          viewportCss: { width: context.canvas.clientWidth, height: context.canvas.clientHeight },
          hardwareConcurrency: navigator.hardwareConcurrency
        },
        suite: {
          warmupQueriesPerCase: WARMUP_QUERY_COUNT,
          queryCountPerRound: QUERY_COUNT,
          queryBatch: QUERY_BATCH,
          roundCount: ROUND_COUNT,
          elapsedMs: performance.now() - startedAt
        },
        results,
        cellSizeSweep
      }, null, 2);
      copyButton.disabled = false;
      context.panel.status("interaction benchmark complete · JSON ready");
    } catch (error) {
      context.panel.status(`benchmark failed: ${String(error)}`);
    } finally {
      benchmarkRunning = false;
      runButton.disabled = false;
    }
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

interface QueryRoundResult {
  readonly totalCpuMs: number;
  readonly queryTimingMs: ReturnType<typeof summarize>;
  readonly throughputQueriesPerSecond: number;
  readonly hits: number;
  readonly hitRate: number;
  readonly averageCandidates: number;
  readonly lifetimeMaximumCandidates: number;
}

function runQueries(
  manager: AnnotationInteractionManager,
  width: number,
  height: number,
  queryCount: number,
  sequenceOffset: number,
  area: "viewport" | "center"
): QueryRoundResult {
  const before = getAnnotationInteractionDiagnostics(manager);
  const batches: number[] = [];
  let hits = 0;
  const startedAt = performance.now();
  for (let start = 0; start < queryCount; start += QUERY_BATCH) {
    const batchStartedAt = performance.now();
    const batchEnd = Math.min(start + QUERY_BATCH, queryCount);
    for (let query = start; query < batchEnd; query++) {
      const point = queryPoint(query + sequenceOffset, width, height, area);
      if (pickInteractiveAnnotation(manager, point.x, point.y)) hits++;
    }
    batches.push((performance.now() - batchStartedAt) / (batchEnd - start));
  }
  const totalCpuMs = performance.now() - startedAt;
  const after = getAnnotationInteractionDiagnostics(manager);
  return {
    totalCpuMs,
    queryTimingMs: summarize(batches),
    throughputQueriesPerSecond: queryCount / (totalCpuMs / 1000),
    hits,
    hitRate: hits / queryCount,
    averageCandidates: (after.candidateTests - before.candidateTests) / queryCount,
    lifetimeMaximumCandidates: after.maximumCandidates
  };
}

function queryPoint(
  index: number,
  width: number,
  height: number,
  area: "viewport" | "center"
): { x: number; y: number } {
  const scale = area === "center" ? 0.5 : 1;
  const inset = (1 - scale) * 0.5;
  return {
    x: (inset + ((index * 0.61803398875) % 1) * scale) * width,
    y: (inset + ((index * 0.41421356237) % 1) * scale) * height
  };
}

function summarizeRounds(rounds: readonly QueryRoundResult[]) {
  return {
    totalCpuMs: median(rounds.map((round) => round.totalCpuMs)),
    meanQueryCpuMs: median(rounds.map((round) => round.queryTimingMs.mean)),
    p50QueryCpuMs: median(rounds.map((round) => round.queryTimingMs.p50)),
    p95QueryCpuMs: median(rounds.map((round) => round.queryTimingMs.p95)),
    maxQueryCpuMs: median(rounds.map((round) => round.queryTimingMs.max)),
    throughputQueriesPerSecond: median(rounds.map((round) => round.throughputQueriesPerSecond)),
    hits: median(rounds.map((round) => round.hits)),
    hitRate: median(rounds.map((round) => round.hitRate)),
    averageCandidates: median(rounds.map((round) => round.averageCandidates))
  };
}

function summarize(samples: readonly number[]) {
  const sorted = [...samples].sort((a, b) => a - b);
  const total = samples.reduce((sum, value) => sum + value, 0);
  return {
    mean: total / samples.length,
    p50: percentile(sorted, 0.5),
    p95: percentile(sorted, 0.95),
    max: sorted.at(-1) ?? 0
  };
}

function percentile(sorted: readonly number[], fraction: number): number {
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * fraction) - 1)] ?? 0;
}

function median(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)] ?? 0;
}

function nextFrame(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}
