import {
  addToScene,
  createCylinder,
  createGround,
  createPbrMaterial,
  getMeshGeometry,
  isGpuTimingSupported,
  loadEnvironment,
  loadGltf,
  onBeforeRender,
  playAnimation,
  setGpuTimingEnabled,
  stopAnimation,
  type AnimationGroup,
  type ArcRotateCamera,
  type SceneNode
} from "@babylonjs/lite";
import {
  composeMat4,
  createVatCharacterSet,
  findSkinnedMeshes,
  pickScreenSpaceInstanceFromPointer,
  type InstanceId,
  type VatCharacterSet
} from "../../../src/index.js";
import { createThinInstanceOutliner, tryGetRetainedOutlineGeometry } from "../../../src/outline.js";
import { collectMeshes, createExample, createPanel, runExample } from "../../shared/app.js";
import {
  serializeArenaBenchmarkReport,
  summarizeArenaBenchmarkPhase,
  aggregateArenaPopulationResults,
  ARENA_BENCHMARK_RELIABILITY_DRIFT_PERCENT,
  type ArenaBenchmarkReport,
  type ArenaBenchmarkCounters,
  type ArenaBenchmarkFrame,
  type ArenaBenchmarkPhaseResult,
  type ArenaBenchmarkPassResult,
  type ArenaBenchmarkPopulation,
  type ArenaBenchmarkRecoveryResult,
  type ArenaGeometryWorkload,
  type ArenaPopulationBenchmarkResult
} from "./benchmark.js";

const RAW_ROOT = "https://raw.githubusercontent.com/eldinor/ForBJS/master";
const ENVIRONMENT_URL = "https://assets.babylonjs.com/environments/environmentSpecular.env";
const BRDF_URL = "https://raw.githubusercontent.com/BabylonJS/Babylon-Lite/master/lab/public/brdf-lut.png";
const GOLD: readonly [number, number, number] = [1, 0.64, 0.14];
const TEAL: readonly [number, number, number] = [0.08, 0.9, 0.78];
const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));
const BENCHMARK_WARMUP_MS = 500;
const BENCHMARK_STEADY_MS = 1000;
const BENCHMARK_REACTION_MS = 3000;
const BENCHMARK_REACTION_TIME_SCALE = 3;
const BENCHMARK_POPULATION_COOLDOWN_MS = 750;
const BENCHMARK_BASELINE_MS = 1500;
const BENCHMARK_RECOVERY_SETTLE_MS = 1000;
const BENCHMARK_RECOVERY_WINDOW_MS = 1000;
const BENCHMARK_RECOVERY_MAX_MS = 15000;
const BENCHMARK_RECOVERY_TOLERANCE_PERCENT = 10;

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
  readonly geometry: CrowdGeometryStats;
}

interface CrowdGeometryStats {
  readonly meshParts: number;
  readonly verticesPerCharacter: number;
  readonly trianglesPerCharacter: number;
}

interface PopulationPreset {
  readonly population: ArenaBenchmarkPopulation;
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

type BenchmarkMode = "quick" | "stress";

interface BenchmarkOrder {
  readonly direction: "ascending" | "descending";
  readonly indices: readonly number[];
}

interface BenchmarkRun {
  readonly mode: BenchmarkMode;
  readonly orders: readonly BenchmarkOrder[];
  presetIndex: number;
  passIndex: number;
  positionIndex: number;
  phase: "baseline-cooldown" | "baseline" | "population-cooldown" | "recovery" | "warmup" | "steady" | "reaction";
  elapsedMs: number;
  populationApplyMs: number;
  capture: BenchmarkCapture | undefined;
  steady: ArenaBenchmarkPhaseResult | undefined;
  readonly passes: ArenaBenchmarkPassResult[];
  readonly passResults: ArenaPopulationBenchmarkResult[];
  readonly baselineFrames: ArenaBenchmarkFrame[];
  baselineFrameP95Ms: number;
  baselineGpuP95Ms: number;
  readonly recoveryGpuSamples: number[];
  recoveryLastCheckMs: number;
  latestRecoveryGpuP95Ms: number;
  recoveryAfterPopulation: ArenaBenchmarkPopulation | undefined;
  recoveryAfterPassIteration: number;
  readonly recoveries: ArenaBenchmarkRecoveryResult[];
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
  { population: 100, label: "100", counts: { citizens: 80, aliens: 14, robots: 6 } },
  { population: 500, label: "500", counts: { citizens: 400, aliens: 70, robots: 30 } },
  { population: 1000, label: "1,000", counts: { citizens: 800, aliens: 140, robots: 60 } },
  { population: 1500, label: "1,500", counts: { citizens: 1200, aliens: 210, robots: 90 } },
  { population: 2000, label: "2,000", counts: { citizens: 1600, aliens: 280, robots: 120 } },
  { population: 2500, label: "2,500", counts: { citizens: 2000, aliens: 360, robots: 140 } }
];
const BENCHMARK_POPULATION_INDICES = POPULATIONS.slice(0, -2).map((_, index) => index);
const BENCHMARK_ORDERS: readonly BenchmarkOrder[] = [
  { direction: "ascending" as const, indices: BENCHMARK_POPULATION_INDICES },
  { direction: "descending" as const, indices: [...BENCHMARK_POPULATION_INDICES].reverse() }
] as const;

const ctx = await createExample("Massive Avatar Arena");
const gpuTimingSupported = isGpuTimingSupported(ctx.engine);
if (gpuTimingSupported) setGpuTimingEnabled(ctx.engine, true);
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
let reactionTimeScale = 1;
let timeSeconds = 0;
let selected: Selection | undefined;
const frameSamples: number[] = [];
const playbackMutationSamples: number[] = [];
let telemetryFrames = 0;
let benchmarkRun: BenchmarkRun | undefined;
let latestBenchmarkReport: ArenaBenchmarkReport | undefined;

const selectionMarker = createSelectionMarker();
const benchmarkPanel = createPanel("Benchmark");
benchmarkPanel.root.classList.add("benchmark-panel");
benchmarkPanel.root.querySelector(".panel-home")?.remove();
document.body.append(benchmarkPanel.root);
const benchmarkStatus = document.createElement("div");
benchmarkStatus.className = "benchmark-status";
benchmarkStatus.setAttribute("role", "status");
benchmarkStatus.setAttribute("aria-live", "polite");
benchmarkStatus.hidden = true;
document.body.append(benchmarkStatus);
benchmarkPanel.set("status", "ready");
benchmarkPanel.set("GPU timing", gpuTimingSupported ? "enabled · awaiting samples" : "unsupported by adapter/device");
benchmarkPanel.set("format", "quick: one pass to 1,500 · optional 2-pass stress · stop available");
const fullGeometryWorkload = getGeometryWorkload(POPULATIONS.length - 1);
benchmarkPanel.set(
  "full crowd geometry",
  `${fullGeometryWorkload.sourceMeshParts} source parts · ${formatCount(fullGeometryWorkload.renderedVertices)} vertices · ` +
    `${formatCount(fullGeometryWorkload.renderedTriangles)} triangles/frame`
);
const populationButton = ctx.panel.button("population: 100", () => {
  if (benchmarkRun) return;
  populationIndex = (populationIndex + 1) % POPULATIONS.length;
  populationButton.textContent = `population: ${POPULATIONS[populationIndex]!.label}`;
  applyPopulation();
});
const benchmarkButtonLabel = "quick benchmark: 100 / 500 / 1,000 / 1,500";
const benchmarkButton = benchmarkPanel.button(benchmarkButtonLabel, () => {
  if (benchmarkRun) stopArenaBenchmark();
  else startArenaBenchmark("quick");
});
const stressBenchmarkButton = benchmarkPanel.button("stress benchmark: 2 passes after cool-down", () => {
  startArenaBenchmark("stress");
});
const copyBenchmarkButton = benchmarkPanel.button("copy report", () => {
  void copyBenchmarkReport();
});
copyBenchmarkButton.disabled = true;
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
  const geometry = measureCrowdGeometry(root);
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
  return { spec, characters, members, geometry };
}

function measureCrowdGeometry(root: SceneNode): CrowdGeometryStats {
  let meshParts = 0;
  let verticesPerCharacter = 0;
  let trianglesPerCharacter = 0;
  for (const mesh of findSkinnedMeshes(root)) {
    const geometry = getMeshGeometry(mesh);
    if (!geometry) continue;
    meshParts++;
    verticesPerCharacter += geometry.positions.length / 3;
    trianglesPerCharacter += geometry.indices.length / 3;
  }
  return { meshParts, verticesPerCharacter, trianglesPerCharacter };
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
    pool.characters.batchPlayback(() => {
      pool.characters.setVisibleMany(pool.members.slice(0, visibleCount).map((member) => member.id), true);
      pool.characters.setVisibleMany(pool.members.slice(visibleCount).map((member) => member.id), false);
    });
  }
  if (selected && !selected.pool.characters.getVisible(selected.member.id)) clearSelection();
}

function startReactionWave(timeScale = 1): void {
  reactionStartedAt = timeSeconds;
  reactionTimeScale = timeScale;
  heroReturnAt = timeSeconds + 1.5;
  activateHero("kick");
  for (const pool of pools) {
    for (const member of pool.members) setMemberStage(pool, member, "base");
  }
}

function updateReactionWave(): void {
  if (reactionStartedAt === undefined) return;
  const elapsed = (timeSeconds - reactionStartedAt) * reactionTimeScale;
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
  if (complete) {
    reactionStartedAt = undefined;
    reactionTimeScale = 1;
  }
}

function setMemberStage(pool: CrowdPool, member: CrowdMember, stage: ReactionStage): void {
  if (member.stage === stage) return;
  member.stage = stage;
  const started = performance.now();
  const action = stage === "base" ? member.baseAction : stage;
  const clipName = pool.spec.clips[action];
  const clip = pool.characters.clips[clipName];
  pool.characters.setPlayback(member.id, {
    clip: clipName,
    ...(clip
      ? { offset: hash01(member.index * 53 + timeSeconds) * 0.08 * (clip.frameCount / clip.fps) }
      : {})
  });
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
      getWorldPosition: (id, out) => {
        const member = pool.characters.primary.set.getMetadata(id);
        if (!member || !out) return undefined;
        out[0] = member.x;
        out[1] = 0.9;
        out[2] = member.z;
        return out;
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

function startArenaBenchmark(mode: BenchmarkMode): void {
  if (benchmarkRun) return;
  paused = false;
  hero.active.speedRatio = 1;
  heroView = false;
  focusCamera();
  ctx.setCameraControlsEnabled(false);
  clearSelection();
  benchmarkButton.textContent = "stop benchmark";
  stressBenchmarkButton.disabled = true;
  copyBenchmarkButton.disabled = true;
  setBenchmarkStatus(mode === "quick" ? "starting quick benchmark" : "starting optional stress benchmark");
  benchmarkRun = {
    mode,
    orders: mode === "quick" ? BENCHMARK_ORDERS.slice(0, 1) : BENCHMARK_ORDERS,
    presetIndex: 0,
    passIndex: 0,
    positionIndex: 0,
    phase: "baseline-cooldown",
    elapsedMs: 0,
    populationApplyMs: 0,
    capture: undefined,
    steady: undefined,
    passes: [],
    passResults: [],
    baselineFrames: [],
    baselineFrameP95Ms: 0,
    baselineGpuP95Ms: 0,
    recoveryGpuSamples: [],
    recoveryLastCheckMs: 0,
    latestRecoveryGpuP95Ms: 0,
    recoveryAfterPopulation: undefined,
    recoveryAfterPassIteration: 0,
    recoveries: []
  };
  beginBenchmarkBaseline();
}

function stopArenaBenchmark(): void {
  if (!benchmarkRun) return;
  benchmarkRun = undefined;
  reactionStartedAt = undefined;
  reactionTimeScale = 1;
  populationIndex = 0;
  populationButton.textContent = `population: ${POPULATIONS[0]!.label}`;
  applyPopulation();
  ctx.setCameraControlsEnabled(true);
  benchmarkButton.textContent = benchmarkButtonLabel;
  stressBenchmarkButton.disabled = false;
  copyBenchmarkButton.disabled = latestBenchmarkReport === undefined;
  setBenchmarkStatus("stopped · returned to 100 avatars", false);
}

function setBenchmarkStatus(message: string, visible = true): void {
  benchmarkPanel.set("status", message);
  benchmarkStatus.textContent = `BENCHMARK · ${message}`;
  benchmarkStatus.hidden = !visible;
}

function beginBenchmarkBaseline(): void {
  const run = benchmarkRun;
  if (!run) return;
  populationIndex = 0;
  populationButton.textContent = `population: ${POPULATIONS[0]!.label}`;
  applyPopulation();
  run.phase = "baseline-cooldown";
  run.elapsedMs = 0;
  run.baselineFrames.length = 0;
  setBenchmarkStatus("establishing 100-avatar baseline · cooling down");
}

function beginBenchmarkPopulation(presetIndex: number): void {
  const run = benchmarkRun;
  if (!run) return;
  run.presetIndex = presetIndex;
  run.phase = "population-cooldown";
  run.elapsedMs = 0;
  run.capture = undefined;
  run.steady = undefined;
  reactionStartedAt = undefined;
  reactionTimeScale = 1;
  for (const pool of pools) {
    for (const member of pool.members) setMemberStage(pool, member, "base");
  }
  populationIndex = presetIndex;
  populationButton.textContent = `population: ${POPULATIONS[presetIndex]!.label}`;
  const started = performance.now();
  applyPopulation();
  run.populationApplyMs = performance.now() - started;
  setBenchmarkStatus(
    `${run.orders[run.passIndex]!.direction} · ${POPULATIONS[presetIndex]!.label}: cooling down`
  );
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
  setBenchmarkStatus(`${POPULATIONS[run.presetIndex]!.label}: ${phase}`);
}

function advanceArenaBenchmark(deltaMs: number, updateMs: number): void {
  const run = benchmarkRun;
  if (!run) return;
  run.elapsedMs += deltaMs;
  if (run.phase === "baseline-cooldown") {
    if (run.elapsedMs >= BENCHMARK_POPULATION_COOLDOWN_MS) {
      run.phase = "baseline";
      run.elapsedMs = 0;
      setBenchmarkStatus("measuring 100-avatar recovery baseline");
    }
    return;
  }
  if (run.phase === "baseline") {
    run.baselineFrames.push({
      frameMs: deltaMs,
      updateMs,
      gpuMs: ctx.engine.gpuFrameTimeMs,
      drawCalls: ctx.engine.drawCallCount
    });
    if (run.elapsedMs >= BENCHMARK_BASELINE_MS) {
      run.baselineFrameP95Ms = percentile(run.baselineFrames.map((sample) => sample.frameMs), 0.95);
      run.baselineGpuP95Ms = percentile(
        run.baselineFrames.map((sample) => sample.gpuMs).filter((sample) => sample > 0),
        0.95
      );
      benchmarkPanel.set(
        "baseline",
        `frame ${run.baselineFrameP95Ms.toFixed(2)} ms · GPU ${formatGpuMs(run.baselineGpuP95Ms)}`
      );
      beginBenchmarkPopulation(0);
    }
    return;
  }
  if (run.phase === "recovery") {
    advanceBenchmarkRecovery(run);
    return;
  }
  if (run.phase === "population-cooldown") {
    if (run.elapsedMs >= BENCHMARK_POPULATION_COOLDOWN_MS) {
      run.phase = "warmup";
      run.elapsedMs = 0;
      setBenchmarkStatus(
        `${run.orders[run.passIndex]!.direction} · ${POPULATIONS[run.presetIndex]!.label}: warming up`
      );
    }
    return;
  }
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
    startReactionWave(BENCHMARK_REACTION_TIME_SCALE);
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
    geometry: getGeometryWorkload(run.presetIndex),
    steady,
    reaction,
    passed:
      visibleCount === expectedPopulation &&
      steady.frames > 0 &&
      reaction.frames > 0 &&
      Number.isFinite(steady.frameP95Ms) &&
      Number.isFinite(reaction.frameP95Ms),
    sampleCount: 1,
    frameP95DriftPercent: 0,
    gpuP95DriftPercent: undefined,
    reliable: false
  };
  run.passResults.push(result);
  advanceBenchmarkSequence(run, expectedPopulation);
}

function advanceBenchmarkSequence(run: BenchmarkRun, completedPopulation: ArenaBenchmarkPopulation): void {
  const completedPassIteration = run.passIndex + 1;
  const order = run.orders[run.passIndex]!;
  run.positionIndex += 1;
  if (run.positionIndex >= order.indices.length) {
    run.passes.push({
      iteration: completedPassIteration,
      direction: order.direction,
      results: [...run.passResults]
    });
    run.passResults.length = 0;
    run.passIndex += 1;
    run.positionIndex = 0;
  }

  if (run.passIndex >= run.orders.length) {
    finishArenaBenchmark(aggregateBenchmarkResults(run.passes), run, true, undefined, run.passes);
    return;
  }

  if (completedPopulation > 100) {
    beginBenchmarkRecovery(run, completedPopulation, completedPassIteration);
    return;
  }

  const nextOrder = run.orders[run.passIndex]!;
  beginBenchmarkPopulation(nextOrder.indices[run.positionIndex]!);
}

function getBenchmarkReportPasses(run: BenchmarkRun): readonly ArenaBenchmarkPassResult[] {
  if (run.passResults.length === 0 || run.passIndex >= run.orders.length) return run.passes;
  return [
    ...run.passes,
    {
      iteration: run.passIndex + 1,
      direction: run.orders[run.passIndex]!.direction,
      results: [...run.passResults]
    }
  ];
}

function aggregateBenchmarkResults(
  passes: readonly ArenaBenchmarkPassResult[]
): readonly ArenaPopulationBenchmarkResult[] {
  return BENCHMARK_POPULATION_INDICES.map((index) => POPULATIONS[index]!).flatMap((preset) => {
    const samples = passes.flatMap((pass) =>
      pass.results.filter((result) => result.population === preset.population)
    );
    return samples.length > 0 ? [aggregateArenaPopulationResults(samples)] : [];
  });
}

function beginBenchmarkRecovery(
  run: BenchmarkRun,
  afterPopulation: ArenaBenchmarkPopulation,
  passIteration: number
): void {
  populationIndex = 0;
  populationButton.textContent = `population: ${POPULATIONS[0]!.label}`;
  applyPopulation();
  reactionStartedAt = undefined;
  reactionTimeScale = 1;
  run.phase = "recovery";
  run.elapsedMs = 0;
  run.capture = undefined;
  run.steady = undefined;
  run.recoveryGpuSamples.length = 0;
  run.recoveryLastCheckMs = BENCHMARK_RECOVERY_SETTLE_MS;
  run.latestRecoveryGpuP95Ms = 0;
  run.recoveryAfterPopulation = afterPopulation;
  run.recoveryAfterPassIteration = passIteration;
  setBenchmarkStatus(`recovering at 100 after ${afterPopulation.toLocaleString()} avatars`);
}

function advanceBenchmarkRecovery(run: BenchmarkRun): void {
  if (run.elapsedMs >= BENCHMARK_RECOVERY_SETTLE_MS && ctx.engine.gpuFrameTimeMs > 0) {
    run.recoveryGpuSamples.push(ctx.engine.gpuFrameTimeMs);
  }

  const windowComplete = run.elapsedMs - run.recoveryLastCheckMs >= BENCHMARK_RECOVERY_WINDOW_MS;
  if (windowComplete) {
    run.latestRecoveryGpuP95Ms = percentile(run.recoveryGpuSamples, 0.95);
    run.recoveryGpuSamples.length = 0;
    run.recoveryLastCheckMs = run.elapsedMs;
    const recoveryLimit = run.baselineGpuP95Ms * (1 + BENCHMARK_RECOVERY_TOLERANCE_PERCENT / 100);
    const recovered =
      gpuTimingSupported &&
      run.baselineGpuP95Ms > 0 &&
      run.latestRecoveryGpuP95Ms > 0 &&
      run.latestRecoveryGpuP95Ms <= recoveryLimit;
    benchmarkPanel.set(
      "recovery",
      `${formatGpuMs(run.latestRecoveryGpuP95Ms)} / ${formatGpuMs(recoveryLimit)} limit`
    );
    if (recovered) {
      finishBenchmarkRecovery(run, true);
      return;
    }
  }

  if (!gpuTimingSupported && windowComplete) {
    finishBenchmarkRecovery(run, true);
    return;
  }
  if (run.elapsedMs >= BENCHMARK_RECOVERY_MAX_MS) {
    finishBenchmarkRecovery(run, false);
  }
}

function finishBenchmarkRecovery(run: BenchmarkRun, recovered: boolean): void {
  const afterPopulation = run.recoveryAfterPopulation;
  if (afterPopulation === undefined) throw new Error("Avatar Arena recovery completed without a population.");
  run.recoveries.push({
    afterPopulation,
    passIteration: run.recoveryAfterPassIteration,
    durationMs: run.elapsedMs,
    gpuP95Ms: run.latestRecoveryGpuP95Ms,
    recovered
  });
  run.recoveryAfterPopulation = undefined;
  if (!recovered) {
    abortArenaBenchmark(run, `thermal recovery failed after ${afterPopulation.toLocaleString()} avatars`);
    return;
  }
  const order = run.orders[run.passIndex]!;
  beginBenchmarkPopulation(order.indices[run.positionIndex]!);
}

function abortArenaBenchmark(run: BenchmarkRun, reason: string): void {
  const passes = getBenchmarkReportPasses(run);
  finishArenaBenchmark(aggregateBenchmarkResults(passes), run, false, reason, passes);
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

function finishArenaBenchmark(
  results: readonly ArenaPopulationBenchmarkResult[],
  run: BenchmarkRun,
  completed: boolean,
  stopReason: string | undefined,
  passes: readonly ArenaBenchmarkPassResult[]
): void {
  const report: ArenaBenchmarkReport = {
    schemaVersion: 6,
    timestamp: new Date().toISOString(),
    environment: {
      userAgent: navigator.userAgent,
      hardwareConcurrency: navigator.hardwareConcurrency,
      renderingBackend: "webgpu",
      gpuTimingSupported
    },
    settings: {
      mode: run.mode,
      warmupMs: BENCHMARK_WARMUP_MS,
      steadyMs: BENCHMARK_STEADY_MS,
      reactionMs: BENCHMARK_REACTION_MS,
      reactionTimeScale: BENCHMARK_REACTION_TIME_SCALE,
      populationCooldownMs: BENCHMARK_POPULATION_COOLDOWN_MS,
      baselineMs: BENCHMARK_BASELINE_MS,
      recoverySettleMs: BENCHMARK_RECOVERY_SETTLE_MS,
      recoveryWindowMs: BENCHMARK_RECOVERY_WINDOW_MS,
      recoveryMaxMs: BENCHMARK_RECOVERY_MAX_MS,
      recoveryTolerancePercent: BENCHMARK_RECOVERY_TOLERANCE_PERCENT,
      reliabilityDriftPercent: ARENA_BENCHMARK_RELIABILITY_DRIFT_PERCENT,
      passCount: run.orders.length,
      populations: BENCHMARK_POPULATION_INDICES.map((index) => POPULATIONS[index]!.population)
    },
    completed,
    ...(stopReason === undefined ? {} : { stopReason }),
    baseline: { frameP95Ms: run.baselineFrameP95Ms, gpuP95Ms: run.baselineGpuP95Ms },
    results,
    passes,
    recoveries: run.recoveries
  };
  latestBenchmarkReport = report;
  (globalThis as typeof globalThis & { __liteInstancerArenaBenchmark?: unknown }).__liteInstancerArenaBenchmark = report;
  for (const result of results) showBenchmarkResult(result);
  console.table(results.map((result) => ({
    population: result.population,
    applyMs: result.populationApplyMs.toFixed(2),
    steadyP95Ms: result.steady.frameP95Ms.toFixed(2),
    reactionP95Ms: result.reaction.frameP95Ms.toFixed(2),
    updateP95Ms: result.reaction.updateP95Ms.toFixed(2),
    gpuP95Ms: formatGpuMs(result.reaction.gpuP95Ms),
    averageDraws: result.reaction.averageDrawCalls.toFixed(1),
    renderedVertices: Math.round(result.geometry.renderedVertices),
    renderedTriangles: Math.round(result.geometry.renderedTriangles),
    mutationP95Ms: result.reaction.playbackMutationP95Ms.toFixed(3),
    uploadCalls: result.reaction.uploads.backendUploadCalls,
    uploadMiB: (result.reaction.uploads.backendBytesUploaded / 1024 / 1024).toFixed(2),
    samples: result.sampleCount,
    frameDriftPercent: result.frameP95DriftPercent.toFixed(1),
    gpuDriftPercent: result.gpuP95DriftPercent?.toFixed(1) ?? "n/a",
    passed: result.passed,
    reliable: result.reliable
  })));
  const repeatedResults = results.filter((result) => result.sampleCount > 1);
  const unreliable = repeatedResults.filter((result) => !result.reliable).length;
  const completionStatus = !completed
      ? `stopped · ${stopReason ?? "incomplete"} · partial report ready`
      : !results.every((result) => result.passed)
      ? "complete · validation failed"
      : unreliable > 0
        ? `complete · ${unreliable} unreliable median${unreliable === 1 ? "" : "s"}`
        : run.mode === "quick"
          ? "complete · quick single-pass report ready"
          : "complete · report ready";
  setBenchmarkStatus(completionStatus, false);
  benchmarkRun = undefined;
  reactionStartedAt = undefined;
  reactionTimeScale = 1;
  populationIndex = 0;
  populationButton.textContent = `population: ${POPULATIONS[0]!.label}`;
  applyPopulation();
  ctx.setCameraControlsEnabled(true);
  benchmarkButton.textContent = benchmarkButtonLabel;
  stressBenchmarkButton.disabled = false;
  copyBenchmarkButton.disabled = false;
}

async function copyBenchmarkReport(): Promise<void> {
  if (!latestBenchmarkReport) {
    benchmarkPanel.set("copy", "no report available");
    return;
  }
  const text = serializeArenaBenchmarkReport(latestBenchmarkReport);
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
    } else {
      copyTextFallback(text);
    }
    benchmarkPanel.set("copy", `copied ${text.length.toLocaleString()} characters`);
  } catch (error) {
    benchmarkPanel.set("copy", error instanceof Error ? error.message : "copy failed");
  }
}

function copyTextFallback(text: string): void {
  const input = document.createElement("textarea");
  input.value = text;
  input.style.position = "fixed";
  input.style.opacity = "0";
  document.body.append(input);
  input.select();
  const copied = document.execCommand("copy");
  input.remove();
  if (!copied) throw new Error("Clipboard access is unavailable.");
}

function getBenchmarkCounters(): ArenaBenchmarkCounters {
  const stats = pools.flatMap((pool) => [
    pool.characters.primary.playbackStats,
    ...pool.characters.secondaryParts.map((part) => part.playbackStats)
  ]);
  return {
    flushes: stats.reduce((total, value) => total + value.flushes, 0),
    cpuDirtyBytes: stats.reduce((total, value) => total + value.cpuBytesFlushed, 0),
    backendUploadCalls: stats.reduce((total, value) => total + value.backendUploadCalls, 0),
    backendBytesUploaded: stats.reduce((total, value) => total + value.backendBytesUploaded, 0),
    backingAllocations: stats.reduce((total, value) => total + value.allocations, 0)
  };
}

function getHeapBytes(): number | undefined {
  return (performance as Performance & { memory?: { usedJSHeapSize: number } }).memory?.usedJSHeapSize;
}

function getBenchmarkPopulation(index: number): ArenaBenchmarkPopulation {
  return POPULATIONS[index]?.population ?? 100;
}

function getGeometryWorkload(presetIndex: number): ArenaGeometryWorkload {
  const preset = POPULATIONS[presetIndex] ?? POPULATIONS[0]!;
  return {
    sourceMeshParts: pools.reduce((total, pool) => total + pool.geometry.meshParts, 0),
    renderedMeshInstances: pools.reduce(
      (total, pool) => total + preset.counts[pool.spec.kind] * pool.geometry.meshParts,
      0
    ),
    renderedVertices: pools.reduce(
      (total, pool) => total + preset.counts[pool.spec.kind] * pool.geometry.verticesPerCharacter,
      0
    ),
    renderedTriangles: pools.reduce(
      (total, pool) => total + preset.counts[pool.spec.kind] * pool.geometry.trianglesPerCharacter,
      0
    )
  };
}

function showBenchmarkResult(result: ArenaPopulationBenchmarkResult): void {
  const label = `${result.sampleCount > 1 ? "median" : "sample"} ${result.population.toLocaleString()}`;
  benchmarkPanel.set(
    `${label} timing`,
    `F ${result.steady.frameP95Ms.toFixed(2)}/${result.reaction.frameP95Ms.toFixed(2)} ms · ` +
      `U ${result.reaction.updateP95Ms.toFixed(2)} ms · G ${formatGpuMs(result.reaction.gpuP95Ms)}`
  );
  benchmarkPanel.set(
    `${label} work`,
    `${result.reaction.playbackMutationCount.toFixed(0)} edits · ${result.reaction.averageDrawCalls.toFixed(1)} draws · ` +
      `${result.reaction.uploads.backendUploadCalls.toFixed(0)} calls · ${formatBytes(result.reaction.uploads.backendBytesUploaded)}`
  );
  benchmarkPanel.set(
    `${label} geometry`,
    `${formatCount(result.geometry.renderedMeshInstances)} mesh instances · ` +
      `${formatCount(result.geometry.renderedVertices)} vertices · ${formatCount(result.geometry.renderedTriangles)} triangles`
  );
  benchmarkPanel.set(
    `${label} confidence`,
    result.sampleCount < 2
      ? "1 sample · repeatability not measured"
      : `${result.sampleCount} samples · F drift ${result.frameP95DriftPercent.toFixed(1)}% · ` +
        `G drift ${result.gpuP95DriftPercent === undefined ? "n/a" : `${result.gpuP95DriftPercent.toFixed(1)}%`} · ` +
        (result.reliable ? "reliable" : "unreliable")
  );
}

function formatBytes(bytes: number): string {
  return `${(bytes / 1024 / 1024).toFixed(2)} MiB`;
}

function formatCount(value: number): string {
  return Math.round(value).toLocaleString();
}

function formatGpuMs(milliseconds: number): string {
  if (milliseconds > 0) return `${milliseconds.toFixed(2)} ms`;
  return gpuTimingSupported ? "pending" : "unsupported";
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
    benchmarkPanel.set("live frame p50 / p95", `${percentile(frameSamples, 0.5).toFixed(2)} / ${percentile(frameSamples, 0.95).toFixed(2)} ms`);
    benchmarkPanel.set("live playback p50 / p95", `${percentile(playbackMutationSamples, 0.5).toFixed(3)} / ${percentile(playbackMutationSamples, 0.95).toFixed(3)} ms`);
    const counters = getBenchmarkCounters();
    benchmarkPanel.set("live VAT uploaded", `${(counters.backendBytesUploaded / 1024 / 1024).toFixed(2)} MiB / ${counters.backendUploadCalls} calls`);
    benchmarkPanel.set("live GPU / draws", `${formatGpuMs(ctx.engine.gpuFrameTimeMs)} / ${ctx.engine.drawCallCount}`);
  }
  ctx.panel.set("selected", selected ? `${selected.pool.spec.kind} #${Number(selected.member.id)} · ${selected.member.stage}` : "-");
  ctx.panel.set("status", "running");
}

function publishBenchmark(updateMs: number): void {
  const memory = (performance as Performance & { memory?: { usedJSHeapSize: number } }).memory;
  const stats = pools.flatMap((pool) => [pool.characters.primary.playbackStats, ...pool.characters.secondaryParts.map((part) => part.playbackStats)]);
  (globalThis as typeof globalThis & { __liteInstancerBenchmark?: unknown }).__liteInstancerBenchmark = {
    schemaVersion: 2,
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
      backendUploadCalls: stats.reduce((total, value) => total + value.backendUploadCalls, 0),
      backendBytesUploaded: stats.reduce((total, value) => total + value.backendBytesUploaded, 0),
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
