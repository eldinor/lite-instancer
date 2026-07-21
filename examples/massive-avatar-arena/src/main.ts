import {
  addToScene,
  createCylinder,
  createGround,
  createPbrMaterial,
  loadEnvironment,
  loadGltf,
  onBeforeRender,
  playAnimation,
  stopAnimation,
  type AnimationGroup,
  type ArcRotateCamera,
  type SceneNode
} from "@babylonjs/lite";
import {
  composeMat4,
  createVatCharacterSet,
  pickScreenSpaceInstanceFromPointer,
  type InstanceId,
  type VatCharacterSet
} from "../../../src/index.js";
import { createThinInstanceOutliner, tryGetRetainedOutlineGeometry } from "../../../src/outline.js";
import { collectMeshes, createExample, runExample } from "../../shared/app.js";
import {
  summarizeArenaBenchmarkPhase,
  type ArenaBenchmarkCounters,
  type ArenaBenchmarkFrame,
  type ArenaBenchmarkPhaseResult,
  type ArenaPopulationBenchmarkResult
} from "./benchmark.js";

const RAW_ROOT = "https://raw.githubusercontent.com/eldinor/ForBJS/master";
const ENVIRONMENT_URL = "https://assets.babylonjs.com/environments/environmentSpecular.env";
const BRDF_URL = "https://raw.githubusercontent.com/BabylonJS/Babylon-Lite/master/lab/public/brdf-lut.png";
const GOLD: readonly [number, number, number] = [1, 0.64, 0.14];
const TEAL: readonly [number, number, number] = [0.08, 0.9, 0.78];
const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));
const BENCHMARK_WARMUP_MS = 1500;
const BENCHMARK_STEADY_MS = 3000;
const BENCHMARK_REACTION_MS = 8500;

type Action = "idle" | "walk" | "run" | "jump" | "kick" | "fall" | "land";
type CrowdKind = "citizens" | "aliens" | "robots";
type ReactionStage = "base" | "jump" | "kick" | "fall" | "land";

interface CrowdSpec {
  readonly kind: CrowdKind;
  readonly label: string;
  readonly asset: string;
  readonly capacity: number;
  readonly innerRadius: number;
  readonly outerRadius: number;
  readonly clips: Readonly<Record<Action, string>>;
}

interface CrowdMember {
  id: InstanceId;
  readonly index: number;
  readonly x: number;
  readonly z: number;
  readonly baseAction: Action;
  readonly baseClip: string;
  stage: ReactionStage;
}

interface CrowdPool {
  readonly spec: CrowdSpec;
  readonly characters: VatCharacterSet<CrowdMember>;
  readonly members: CrowdMember[];
}

interface PopulationPreset {
  readonly label: string;
  readonly counts: Readonly<Record<CrowdKind, number>>;
}

interface Selection {
  readonly pool: CrowdPool;
  readonly member: CrowdMember;
}

interface BenchmarkCapture {
  elapsedMs: number;
  readonly frames: ArenaBenchmarkFrame[];
  readonly mutations: number[];
  readonly countersBefore: ArenaBenchmarkCounters;
  readonly heapBefore: number | undefined;
}

interface BenchmarkRun {
  presetIndex: number;
  phase: "warmup" | "steady" | "reaction";
  elapsedMs: number;
  populationApplyMs: number;
  capture: BenchmarkCapture | undefined;
  steady: ArenaBenchmarkPhaseResult | undefined;
  readonly results: ArenaPopulationBenchmarkResult[];
}

const CROWD_SPECS: readonly CrowdSpec[] = [
  {
    kind: "citizens",
    label: "Avatar 3 citizens",
    asset: `${RAW_ROOT}/avatar_3.glb`,
    capacity: 2000,
    innerRadius: 30,
    outerRadius: 70,
    clips: {
      idle: "Idle",
      walk: "Walk",
      run: "Run",
      jump: "Jump",
      kick: "SoccerKick",
      fall: "Falling",
      land: "FallingToLanding"
    }
  },
  {
    kind: "aliens",
    label: "Avatar 2 aliens",
    asset: `${RAW_ROOT}/avatar_2.glb`,
    capacity: 360,
    innerRadius: 18,
    outerRadius: 29,
    clips: {
      idle: "Idle02_game03",
      walk: "Walk02_game03",
      run: "Run02_game03",
      jump: "Jump_game03",
      kick: "SoccerKick02_game03",
      fall: "FallingIdle_game03",
      land: "FallingToLanding_game03"
    }
  },
  {
    kind: "robots",
    label: "Avatar 4 robots",
    asset: `${RAW_ROOT}/avatar_4.glb`,
    capacity: 140,
    innerRadius: 9,
    outerRadius: 16,
    clips: {
      idle: "Idle",
      walk: "walk02_robot.001",
      run: "Run02_game04",
      jump: "Jump_game04.001",
      kick: "SoccerKick02_game04.001",
      fall: "FallingIdle_game04.001",
      land: "FallingToLanding_game04.001"
    }
  }
];

const HERO_CLIPS: Readonly<Record<Action, string>> = {
  idle: "Idle",
  walk: "Walk",
  run: "Run",
  jump: "Jump",
  kick: "SoccerKick",
  fall: "Fallling",
  land: "FallingToLanding"
};

const POPULATIONS: readonly PopulationPreset[] = [
  { label: "100", counts: { citizens: 80, aliens: 14, robots: 6 } },
  { label: "500", counts: { citizens: 400, aliens: 70, robots: 30 } },
  { label: "2,500", counts: { citizens: 2000, aliens: 360, robots: 140 } }
];

const ctx = await createExample("Massive Avatar Arena");
ctx.panel.set("status", "loading four animated avatars");
await loadEnvironment(ctx.scene, ENVIRONMENT_URL, { brdfUrl: BRDF_URL });
createArena();

const hero = await createHero();
const pools: CrowdPool[] = [];
for (const spec of CROWD_SPECS) pools.push(await createCrowdPool(spec));

let populationIndex = 0;
let paused = false;
let heroView = false;
let heroAction: Action = "idle";
let heroReturnAt: number | undefined;
let reactionStartedAt: number | undefined;
let timeSeconds = 0;
let selected: Selection | undefined;
const frameSamples: number[] = [];
const playbackMutationSamples: number[] = [];
const lastFlushes = new WeakMap<object, number>();
let estimatedVatUploadBytes = 0;
let telemetryFrames = 0;
let benchmarkRun: BenchmarkRun | undefined;

const selectionMarker = createSelectionMarker();
const populationButton = ctx.panel.button("population: 100", () => {
  if (benchmarkRun) return;
  populationIndex = (populationIndex + 1) % POPULATIONS.length;
  populationButton.textContent = `population: ${POPULATIONS[populationIndex]!.label}`;
  applyPopulation();
});
const benchmarkButton = ctx.panel.button("benchmark 100 / 500 / 2,500", startArenaBenchmark);
ctx.panel.button("reaction wave", () => {
  if (!benchmarkRun) startReactionWave();
});
ctx.panel.button("next hero action", () => {
  if (benchmarkRun) return;
  const actions: readonly Action[] = ["idle", "walk", "run", "jump", "kick", "fall", "land"];
  const next = actions[(actions.indexOf(heroAction) + 1) % actions.length] ?? "idle";
  activateHero(next);
  heroReturnAt = undefined;
});
ctx.panel.button("pause animation", () => {
  if (benchmarkRun) return;
  paused = !paused;
  hero.active.speedRatio = paused ? 0 : 1;
});
ctx.panel.button("hero / arena camera", () => {
  heroView = !heroView;
  focusCamera();
});
ctx.panel.button("clear selection", clearSelection);

applyPopulation();
focusCamera();
ctx.canvas.addEventListener("pointerdown", selectFromPointer);

onBeforeRender(ctx.scene, (deltaMs) => {
  const updateStarted = performance.now();
  const deltaSeconds = deltaMs * 0.001;
  if (!paused) {
    timeSeconds += deltaSeconds;
    for (const pool of pools) pool.characters.update(deltaSeconds);
    updateReactionWave();
    if (heroReturnAt !== undefined && timeSeconds >= heroReturnAt) {
      heroReturnAt = undefined;
      activateHero("idle");
    }
  }
  pushSample(frameSamples, deltaMs);
  const updateMs = performance.now() - updateStarted;
  updateVatUploadEstimate();
  advanceArenaBenchmark(deltaMs, updateMs);
  publishBenchmark(updateMs);
  updateTelemetry();
});

await runExample(ctx);

async function createHero(): Promise<{
  readonly animations: ReadonlyMap<Action, AnimationGroup>;
  active: AnimationGroup;
  readonly outlinedParts: number;
}> {
  const container = await loadGltf(ctx.engine, `${RAW_ROOT}/avatar_5.glb`);
  const root = container.entities[0];
  if (!isSceneNode(root)) throw new Error("avatar_5.glb did not provide a scene-node root");
  root.position.set(0, 0.42, 0);
  addToScene(ctx.scene, container);

  const byName = new Map((container.animationGroups ?? []).map((animation) => [animation.name, animation]));
  const animations = new Map<Action, AnimationGroup>();
  for (const action of Object.keys(HERO_CLIPS) as Action[]) {
    const animation = byName.get(HERO_CLIPS[action]);
    if (!animation) throw new Error(`avatar_5.glb is missing hero clip "${HERO_CLIPS[action]}"`);
    animations.set(action, animation);
  }

  const outliner = createThinInstanceOutliner(ctx.engine, ctx.scene);
  let outlinedParts = 0;
  for (const mesh of collectMeshes(root)) {
    const geometry = tryGetRetainedOutlineGeometry(mesh);
    if (!geometry) continue;
    mesh.renderOrder = 100;
    outliner.attach(mesh, {
      geometry,
      thickness: 0.024,
      color: GOLD,
      smoothNormals: true,
      pulse: { speed: 2.2, amplitude: 0.18 }
    }).highlight(0);
    outlinedParts++;
  }

  const active = animations.get("idle");
  if (!active) throw new Error("avatar_5.glb did not provide the normalized idle clip");
  active.loopAnimation = true;
  playAnimation(active);
  return { animations, active, outlinedParts };
}

async function createCrowdPool(spec: CrowdSpec): Promise<CrowdPool> {
  ctx.panel.set("status", `baking ${spec.label}`);
  const container = await loadGltf(ctx.engine, spec.asset);
  const root = container.entities[0];
  if (!isSceneNode(root)) throw new Error(`${spec.label} did not provide a scene-node root`);
  const byName = new Map((container.animationGroups ?? []).map((animation) => [animation.name, animation]));
  const animations = Object.values(spec.clips).map((name) => {
    const animation = byName.get(name);
    if (!animation) throw new Error(`${spec.label} is missing clip "${name}"`);
    return animation;
  });
  addToScene(ctx.scene, root);
  const characters = createVatCharacterSet<CrowdMember>(ctx.engine, root, animations, {
    capacity: spec.capacity,
    engine: ctx.engine,
    visibleStrategy: "active-count"
  });
  const members: CrowdMember[] = [];
  for (let index = 0; index < spec.capacity; index++) {
    const placement = getPlacement(spec, index);
    const baseAction = getBaseAction(index);
    const member: CrowdMember = {
      id: -1 as InstanceId,
      index,
      x: placement.x,
      z: placement.z,
      baseAction,
      baseClip: spec.clips[baseAction],
      stage: "base"
    };
    const clip = characters.clips[member.baseClip];
    if (!clip) throw new Error(`${spec.label} did not bake clip "${member.baseClip}"`);
    const duration = clip.frameCount / clip.fps;
    member.id = characters.create({
      transform: composeMat4({
        position: [placement.x, 0, placement.z],
        rotationEuler: [0, Math.atan2(-placement.x, -placement.z), 0],
        scale: 1
      }),
      metadata: member,
      clip: member.baseClip,
      offset: hash01(index * 29 + spec.capacity) * duration,
      fps: clip.fps * (0.92 + hash01(index * 47 + 3) * 0.16)
    });
    members.push(member);
  }
  return { spec, characters, members };
}

function createArena(): void {
  const ground = createGround(ctx.engine, { width: 170, height: 170, subdivisions: 2 });
  ground.material = createPbrMaterial({
    baseColorFactor: [0.018, 0.026, 0.042, 1],
    metallicFactor: 0.35,
    roughnessFactor: 0.72,
    environmentIntensity: 0.8
  });
  addToScene(ctx.scene, ground);

  const platform = createCylinder(ctx.engine, { height: 0.8, diameter: 7, tessellation: 72 });
  platform.position.y = 0;
  platform.material = createPbrMaterial({
    baseColorFactor: [0.08, 0.1, 0.16, 1],
    emissiveColor: [0.08, 0.045, 0.012],
    metallicFactor: 0.75,
    roughnessFactor: 0.28
  });
  addToScene(ctx.scene, platform);

}

function createSelectionMarker() {
  const marker = createCylinder(ctx.engine, { height: 0.035, diameter: 1.7, tessellation: 48 });
  marker.position.y = 0.04;
  marker.scaling.set(0, 0, 0);
  marker.material = createPbrMaterial({
    baseColorFactor: [TEAL[0], TEAL[1], TEAL[2], 1],
    emissiveColor: [TEAL[0], TEAL[1], TEAL[2]],
    metallicFactor: 0.1,
    roughnessFactor: 0.25
  });
  addToScene(ctx.scene, marker);
  return marker;
}

function getPlacement(spec: CrowdSpec, index: number): { x: number; z: number } {
  const normalized = (index + 0.5) / spec.capacity;
  const radiusSquared = spec.innerRadius ** 2 + normalized * (spec.outerRadius ** 2 - spec.innerRadius ** 2);
  const radius = Math.sqrt(radiusSquared);
  const angle = index * GOLDEN_ANGLE + hash01(index + spec.capacity) * 0.16;
  const jitter = (hash01(index * 17 + 11) - 0.5) * 0.7;
  return {
    x: Math.cos(angle) * (radius + jitter),
    z: Math.sin(angle) * (radius + jitter)
  };
}

function getBaseAction(index: number): Action {
  const bucket = index % 10;
  return bucket < 6 ? "idle" : bucket < 8 ? "walk" : "run";
}

function applyPopulation(): void {
  const preset = POPULATIONS[populationIndex] ?? POPULATIONS[0]!;
  for (const pool of pools) {
    const visibleCount = preset.counts[pool.spec.kind];
    for (let index = 0; index < pool.members.length; index++) {
      const member = pool.members[index];
      if (member) pool.characters.setVisible(member.id, index < visibleCount);
    }
  }
  if (selected && !selected.pool.characters.getVisible(selected.member.id)) clearSelection();
}

function startReactionWave(): void {
  reactionStartedAt = timeSeconds;
  heroReturnAt = timeSeconds + 1.5;
  activateHero("kick");
  for (const pool of pools) {
    for (const member of pool.members) setMemberStage(pool, member, "base");
  }
}

function updateReactionWave(): void {
  if (reactionStartedAt === undefined) return;
  const elapsed = timeSeconds - reactionStartedAt;
  let complete = true;
  for (const pool of pools) {
    const visibleCount = getVisibleCount(pool.spec.kind);
    pool.characters.batchPlayback(() => {
      for (let index = 0; index < visibleCount; index++) {
        const member = pool.members[index];
        if (!member) continue;
        const delay = Math.hypot(member.x, member.z) / 18;
        const local = elapsed - delay;
        const stage: ReactionStage = local < 0
          ? "base"
          : local < 0.75
            ? "jump"
            : local < 1.65
              ? "kick"
              : local < 2.35
                ? "fall"
                : local < 3.45
                  ? "land"
                  : "base";
        if (local < 3.45) complete = false;
        setMemberStage(pool, member, stage);
      }
    });
  }
  if (complete) reactionStartedAt = undefined;
}

function setMemberStage(pool: CrowdPool, member: CrowdMember, stage: ReactionStage): void {
  if (member.stage === stage) return;
  member.stage = stage;
  const started = performance.now();
  const action = stage === "base" ? member.baseAction : stage;
  const clipName = pool.spec.clips[action];
  pool.characters.setClip(member.id, clipName);
  const clip = pool.characters.clips[clipName];
  if (clip) pool.characters.setPhaseOffset(member.id, hash01(member.index * 53 + timeSeconds) * 0.08 * (clip.frameCount / clip.fps));
  const mutationMs = performance.now() - started;
  pushSample(playbackMutationSamples, mutationMs);
  benchmarkRun?.capture?.mutations.push(mutationMs);
}

function activateHero(action: Action): void {
  const next = hero.animations.get(action);
  if (!next) return;
  for (const animation of hero.animations.values()) {
    if (animation === next) continue;
    stopAnimation(animation);
  }
  next.currentTime = 0;
  next.loopAnimation = action === "idle" || action === "walk" || action === "run";
  next.speedRatio = paused ? 0 : 1;
  playAnimation(next);
  hero.active = next;
  heroAction = action;
}

function selectFromPointer(event: PointerEvent): void {
  const camera = ctx.scene.camera;
  if (!camera) return;
  let best: Selection | undefined;
  let bestDistance = Infinity;
  for (const pool of pools) {
    const pick = pickScreenSpaceInstanceFromPointer({
      event,
      canvas: ctx.canvas,
      camera,
      ids: pool.characters.primary.set.ids(),
      has: (id) => pool.characters.has(id),
      isVisible: (id) => pool.characters.getVisible(id),
      getWorldPosition: (id) => {
        const member = pool.characters.primary.set.getMetadata(id);
        return member ? [member.x, 0.9, member.z] : undefined;
      },
      getScreenRadius: () => 18
    });
    if (!pick || pick.distanceSquared >= bestDistance) continue;
    const member = pool.characters.primary.set.getMetadata(pick.id);
    if (!member) continue;
    bestDistance = pick.distanceSquared;
    best = { pool, member };
  }
  if (!best) return;
  selected = best;
  selectionMarker.position.x = best.member.x;
  selectionMarker.position.z = best.member.z;
  selectionMarker.scaling.set(1, 1, 1);
}

function clearSelection(): void {
  selected = undefined;
  selectionMarker.scaling.set(0, 0, 0);
}

function focusCamera(): void {
  const camera = ctx.scene.camera;
  if (!isArcRotateCamera(camera)) return;
  camera.target.x = 0;
  camera.target.y = heroView ? 1.05 : 2.5;
  camera.target.z = 0;
  camera.radius = heroView ? 5.2 : 78;
  camera.beta = heroView ? Math.PI / 2.2 : Math.PI / 3.1;
}

function startArenaBenchmark(): void {
  if (benchmarkRun) return;
  paused = false;
  hero.active.speedRatio = 1;
  heroView = false;
  focusCamera();
  clearSelection();
  benchmarkButton.disabled = true;
  benchmarkRun = {
    presetIndex: 0,
    phase: "warmup",
    elapsedMs: 0,
    populationApplyMs: 0,
    capture: undefined,
    steady: undefined,
    results: []
  };
  beginBenchmarkPopulation(0);
}

function beginBenchmarkPopulation(presetIndex: number): void {
  const run = benchmarkRun;
  if (!run) return;
  run.presetIndex = presetIndex;
  run.phase = "warmup";
  run.elapsedMs = 0;
  run.capture = undefined;
  run.steady = undefined;
  reactionStartedAt = undefined;
  for (const pool of pools) {
    for (const member of pool.members) setMemberStage(pool, member, "base");
  }
  populationIndex = presetIndex;
  populationButton.textContent = `population: ${POPULATIONS[presetIndex]!.label}`;
  const started = performance.now();
  applyPopulation();
  run.populationApplyMs = performance.now() - started;
  ctx.panel.set("benchmark", `${POPULATIONS[presetIndex]!.label}: warming up`);
}

function beginBenchmarkCapture(phase: "steady" | "reaction"): void {
  const run = benchmarkRun;
  if (!run) return;
  run.phase = phase;
  run.elapsedMs = 0;
  run.capture = {
    elapsedMs: 0,
    frames: [],
    mutations: [],
    countersBefore: getBenchmarkCounters(),
    heapBefore: getHeapBytes()
  };
  ctx.panel.set("benchmark", `${POPULATIONS[run.presetIndex]!.label}: ${phase}`);
}

function advanceArenaBenchmark(deltaMs: number, updateMs: number): void {
  const run = benchmarkRun;
  if (!run) return;
  run.elapsedMs += deltaMs;
  if (run.phase === "warmup") {
    if (run.elapsedMs >= BENCHMARK_WARMUP_MS) beginBenchmarkCapture("steady");
    return;
  }

  const capture = run.capture;
  if (!capture) return;
  capture.elapsedMs += deltaMs;
  capture.frames.push({
    frameMs: deltaMs,
    updateMs,
    gpuMs: ctx.engine.gpuFrameTimeMs,
    drawCalls: ctx.engine.drawCallCount
  });

  if (run.phase === "steady" && capture.elapsedMs >= BENCHMARK_STEADY_MS) {
    run.steady = finishBenchmarkCapture(capture, BENCHMARK_STEADY_MS);
    beginBenchmarkCapture("reaction");
    startReactionWave();
    return;
  }
  if (run.phase !== "reaction" || capture.elapsedMs < BENCHMARK_REACTION_MS) return;

  const reaction = finishBenchmarkCapture(capture, BENCHMARK_REACTION_MS);
  const steady = run.steady;
  if (!steady) throw new Error("Avatar Arena benchmark reaction completed without a steady sample.");
  const expectedPopulation = getBenchmarkPopulation(run.presetIndex);
  const visibleCount = pools.reduce((total, pool) => total + pool.characters.visibleCount, 0);
  const result: ArenaPopulationBenchmarkResult = {
    population: expectedPopulation,
    populationApplyMs: run.populationApplyMs,
    visibleCount,
    steady,
    reaction,
    passed:
      visibleCount === expectedPopulation &&
      steady.frames > 0 &&
      reaction.frames > 0 &&
      Number.isFinite(steady.frameP95Ms) &&
      Number.isFinite(reaction.frameP95Ms)
  };
  run.results.push(result);
  ctx.panel.set(
    `bench ${expectedPopulation.toLocaleString()}`,
    `steady ${steady.frameP95Ms.toFixed(2)}ms · wave ${reaction.frameP95Ms.toFixed(2)}ms · ` +
      `${reaction.playbackMutationCount} edits · ${formatBytes(reaction.uploads.estimatedGpuBytes)}`
  );

  const nextPreset = run.presetIndex + 1;
  if (nextPreset < POPULATIONS.length) {
    beginBenchmarkPopulation(nextPreset);
    return;
  }
  finishArenaBenchmark(run.results);
}

function finishBenchmarkCapture(capture: BenchmarkCapture, durationMs: number): ArenaBenchmarkPhaseResult {
  const heapAfter = getHeapBytes();
  return summarizeArenaBenchmarkPhase({
    durationMs,
    frames: capture.frames,
    playbackMutations: capture.mutations,
    countersBefore: capture.countersBefore,
    countersAfter: getBenchmarkCounters(),
    ...(capture.heapBefore === undefined ? {} : { heapBefore: capture.heapBefore }),
    ...(heapAfter === undefined ? {} : { heapAfter })
  });
}

function finishArenaBenchmark(results: readonly ArenaPopulationBenchmarkResult[]): void {
  const report = {
    schemaVersion: 1,
    timestamp: new Date().toISOString(),
    environment: {
      userAgent: navigator.userAgent,
      hardwareConcurrency: navigator.hardwareConcurrency,
      renderingBackend: "webgpu"
    },
    settings: {
      warmupMs: BENCHMARK_WARMUP_MS,
      steadyMs: BENCHMARK_STEADY_MS,
      reactionMs: BENCHMARK_REACTION_MS
    },
    results
  };
  (globalThis as typeof globalThis & { __liteInstancerArenaBenchmark?: unknown }).__liteInstancerArenaBenchmark = report;
  console.table(results.map((result) => ({
    population: result.population,
    applyMs: result.populationApplyMs.toFixed(2),
    steadyP95Ms: result.steady.frameP95Ms.toFixed(2),
    reactionP95Ms: result.reaction.frameP95Ms.toFixed(2),
    mutationP95Ms: result.reaction.playbackMutationP95Ms.toFixed(3),
    uploadMiB: (result.reaction.uploads.estimatedGpuBytes / 1024 / 1024).toFixed(2),
    passed: result.passed
  })));
  ctx.panel.set("benchmark", results.every((result) => result.passed) ? "complete · report ready" : "complete · validation failed");
  benchmarkRun = undefined;
  benchmarkButton.disabled = false;
}

function getBenchmarkCounters(): ArenaBenchmarkCounters {
  const stats = pools.flatMap((pool) => [
    pool.characters.primary.playbackStats,
    ...pool.characters.secondaryParts.map((part) => part.playbackStats)
  ]);
  return {
    flushes: stats.reduce((total, value) => total + value.flushes, 0),
    cpuDirtyBytes: stats.reduce((total, value) => total + value.cpuBytesFlushed, 0),
    estimatedGpuBytes: estimatedVatUploadBytes,
    backingAllocations: stats.reduce((total, value) => total + value.allocations, 0)
  };
}

function getHeapBytes(): number | undefined {
  return (performance as Performance & { memory?: { usedJSHeapSize: number } }).memory?.usedJSHeapSize;
}

function getBenchmarkPopulation(index: number): 100 | 500 | 2500 {
  return ([100, 500, 2500] as const)[index] ?? 100;
}

function formatBytes(bytes: number): string {
  return `${(bytes / 1024 / 1024).toFixed(2)} MiB`;
}

function updateTelemetry(): void {
  const preset = POPULATIONS[populationIndex] ?? POPULATIONS[0]!;
  const visible = pools.reduce((total, pool) => total + pool.characters.visibleCount, 0);
  ctx.panel.set("assets", "avatar_2 + avatar_3 + avatar_4 + avatar_5 hero");
  ctx.panel.set("crowd", `${visible.toLocaleString()} visible / 2,500 capacity`);
  ctx.panel.set("mix", `${preset.counts.citizens} citizens / ${preset.counts.aliens} aliens / ${preset.counts.robots} robots`);
  ctx.panel.set("hero", `avatar_5 · ${heroAction} · ${hero.outlinedParts} outlined parts`);
  ctx.panel.set("event", reactionStartedAt === undefined ? "ready" : "radial reaction wave");
  ctx.panel.set("camera", heroView ? "hero" : "arena manual");
  ctx.panel.set("animation", paused ? "paused" : "playing with varied phases/fps");
  if (++telemetryFrames % 30 === 0) {
    ctx.panel.set("frame p50 / p95", `${percentile(frameSamples, 0.5).toFixed(2)} / ${percentile(frameSamples, 0.95).toFixed(2)} ms`);
    ctx.panel.set("playback p50 / p95", `${percentile(playbackMutationSamples, 0.5).toFixed(3)} / ${percentile(playbackMutationSamples, 0.95).toFixed(3)} ms`);
    ctx.panel.set("VAT upload estimate", `${(estimatedVatUploadBytes / 1024 / 1024).toFixed(2)} MiB`);
    ctx.panel.set("GPU / draws", `${ctx.engine.gpuFrameTimeMs.toFixed(2)} ms / ${ctx.engine.drawCallCount}`);
  }
  ctx.panel.set("selected", selected ? `${selected.pool.spec.kind} #${Number(selected.member.id)} · ${selected.member.stage}` : "-");
  ctx.panel.set("status", "running");
}

function updateVatUploadEstimate(): void {
  for (const pool of pools) {
    const stats = [pool.characters.primary.playbackStats, ...pool.characters.secondaryParts.map((part) => part.playbackStats)];
    for (const streamStats of stats) {
      const previous = lastFlushes.get(streamStats) ?? 0;
      const added = streamStats.flushes - previous;
      if (added > 0) estimatedVatUploadBytes += added * pool.characters.count * 4 * Float32Array.BYTES_PER_ELEMENT;
      lastFlushes.set(streamStats, streamStats.flushes);
    }
  }
}

function publishBenchmark(updateMs: number): void {
  const memory = (performance as Performance & { memory?: { usedJSHeapSize: number } }).memory;
  const stats = pools.flatMap((pool) => [pool.characters.primary.playbackStats, ...pool.characters.secondaryParts.map((part) => part.playbackStats)]);
  (globalThis as typeof globalThis & { __liteInstancerBenchmark?: unknown }).__liteInstancerBenchmark = {
    schemaVersion: 1,
    timestamp: new Date().toISOString(),
    environment: {
      userAgent: navigator.userAgent,
      renderingBackend: "webgpu",
      gpuFrameTimeMs: ctx.engine.gpuFrameTimeMs,
      drawCalls: ctx.engine.drawCallCount
    },
    scene: { capacity: 2500, visible: pools.reduce((total, pool) => total + pool.characters.visibleCount, 0) },
    timing: {
      latestUpdateMs: updateMs,
      frameP50Ms: percentile(frameSamples, 0.5),
      frameP95Ms: percentile(frameSamples, 0.95),
      playbackMutationP50Ms: percentile(playbackMutationSamples, 0.5),
      playbackMutationP95Ms: percentile(playbackMutationSamples, 0.95)
    },
    uploads: {
      flushes: stats.reduce((total, value) => total + value.flushes, 0),
      cpuDirtyBytes: stats.reduce((total, value) => total + value.cpuBytesFlushed, 0),
      estimatedGpuBytes: estimatedVatUploadBytes,
      backingAllocations: stats.reduce((total, value) => total + value.allocations, 0)
    },
    heapBytes: memory?.usedJSHeapSize
  };
}

function pushSample(samples: number[], value: number): void {
  samples.push(value);
  if (samples.length > 600) samples.shift();
}

function percentile(samples: readonly number[], fraction: number): number {
  if (samples.length === 0) return 0;
  const sorted = [...samples].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * fraction))] ?? 0;
}

function getVisibleCount(kind: CrowdKind): number {
  const preset = POPULATIONS[populationIndex] ?? POPULATIONS[0]!;
  return preset.counts[kind];
}

function hash01(value: number): number {
  const hashed = Math.sin(value * 12.9898) * 43758.5453123;
  return hashed - Math.floor(hashed);
}

function isSceneNode(value: unknown): value is SceneNode {
  return typeof value === "object" && value !== null && "children" in value && "worldMatrix" in value;
}

function isArcRotateCamera(value: unknown): value is ArcRotateCamera {
  return typeof value === "object" && value !== null && "radius" in value && "target" in value;
}
