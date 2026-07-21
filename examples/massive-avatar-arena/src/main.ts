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

const RAW_ROOT = "https://raw.githubusercontent.com/eldinor/ForBJS/master";
const ENVIRONMENT_URL = "https://assets.babylonjs.com/environments/environmentSpecular.env";
const BRDF_URL = "https://raw.githubusercontent.com/BabylonJS/Babylon-Lite/master/lab/public/brdf-lut.png";
const GOLD: readonly [number, number, number] = [1, 0.64, 0.14];
const TEAL: readonly [number, number, number] = [0.08, 0.9, 0.78];
const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));

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

const selectionMarker = createSelectionMarker();
const populationButton = ctx.panel.button("population: 100", () => {
  populationIndex = (populationIndex + 1) % POPULATIONS.length;
  populationButton.textContent = `population: ${POPULATIONS[populationIndex]!.label}`;
  applyPopulation();
});
ctx.panel.button("reaction wave", startReactionWave);
ctx.panel.button("next hero action", () => {
  const actions: readonly Action[] = ["idle", "walk", "run", "jump", "kick", "fall", "land"];
  const next = actions[(actions.indexOf(heroAction) + 1) % actions.length] ?? "idle";
  activateHero(next);
  heroReturnAt = undefined;
});
ctx.panel.button("pause animation", () => {
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
  }
  if (complete) reactionStartedAt = undefined;
}

function setMemberStage(pool: CrowdPool, member: CrowdMember, stage: ReactionStage): void {
  if (member.stage === stage) return;
  member.stage = stage;
  const action = stage === "base" ? member.baseAction : stage;
  const clipName = pool.spec.clips[action];
  pool.characters.setClip(member.id, clipName);
  const clip = pool.characters.clips[clipName];
  if (clip) pool.characters.setPhaseOffset(member.id, hash01(member.index * 53 + timeSeconds) * 0.08 * (clip.frameCount / clip.fps));
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
  ctx.panel.set("selected", selected ? `${selected.pool.spec.kind} #${Number(selected.member.id)} · ${selected.member.stage}` : "-");
  ctx.panel.set("status", "running");
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
