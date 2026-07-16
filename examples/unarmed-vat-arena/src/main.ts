import {
  addToScene,
  createGround,
  createPbrMaterial,
  createTorus,
  loadEnvironment,
  loadGltf,
  onBeforeRender,
  type ArcRotateCamera,
  type Mat4,
  type SceneNode
} from "@babylonjs/lite";
import {
  composeMat4,
  createVatCharacterSet,
  type InstanceId,
  type VatCharacterSet
} from "../../../src/index.js";
import { createExample, runExample } from "../../shared/app.js";

const UNARMED_URL = "/Unarmed.glb";
const ENVIRONMENT_URL = "https://assets.babylonjs.com/environments/environmentSpecular.env";
const BRDF_URL = "https://raw.githubusercontent.com/BabylonJS/Babylon-Lite/master/lab/public/brdf-lut.png";
const GROUP_CAPACITY = 1000;
// The VAT mesh already carries the GLB hierarchy's authored 0.01 armature
// normalization in `mesh.world`. Scaling instances by 75 turns each fighter
// into arena-sized geometry and collapses the visual crowd into a giant pile.
const MODEL_SCALE = 1;
const DENSITIES = [300, 600, 900, 1200, 1500, 1800, 2100, 2400, 2700, 3000] as const;
const DEFAULT_DENSITY = 900;
const VANGUARD_LANES = 5;

type GroupKind = "vanguard" | "melee" | "sentries";

interface GroupSpec {
  readonly kind: GroupKind;
  readonly label: string;
  readonly clips: readonly string[];
  readonly focus: readonly [number, number, number];
  readonly cameraRadius: number;
}

interface CrowdMember {
  id: InstanceId;
  readonly index: number;
  readonly layoutIndex: number;
  readonly lane: number;
  readonly seed: number;
  readonly speed: number;
  readonly clip: string;
  readonly phaseSeconds: number;
  readonly fps: number;
}

interface CrowdGroup {
  readonly spec: GroupSpec;
  readonly characters: VatCharacterSet;
  readonly members: CrowdMember[];
}

const GROUP_SPECS: readonly GroupSpec[] = [
  {
    kind: "vanguard",
    label: "Vanguard",
    clips: ["UnarmedRunForward"],
    focus: [0, 1.5, 8],
    cameraRadius: 58
  },
  {
    kind: "melee",
    label: "Melee field",
    clips: ["UnarmedAttackL1", "UnarmedAttackR1", "UnarmedBlock", "UnarmedGetHitF1"],
    focus: [0, 1.5, 0],
    cameraRadius: 48
  },
  {
    kind: "sentries",
    label: "Sentry ring",
    clips: ["UnarmedIdle", "UnarmedIdleAlert1", "UnarmedStrafeLeft", "UnarmedStrafeRight"],
    focus: [0, 1.5, 0],
    cameraRadius: 72
  }
];

const ctx = await createExample("Unarmed VAT Arena Crowd");
ctx.panel.set("status", "loading Unarmed VAT groups");
await loadEnvironment(ctx.scene, ENVIRONMENT_URL, { brdfUrl: BRDF_URL });
createArena();

const groups: CrowdGroup[] = [];
for (const spec of GROUP_SPECS) {
  groups.push(await createCrowdGroup(spec));
}

let paused = false;
let autoOrbit = true;
let densityIndex = DENSITIES.indexOf(DEFAULT_DENSITY);
let phaseSeed = 0;
let focusIndex = 0;
let timeSeconds = 0;

const densityButton = ctx.panel.button("density: 900", () => {
  densityIndex = (densityIndex + 1) % DENSITIES.length;
  densityButton.textContent = `density: ${DENSITIES[densityIndex]}`;
  applyDensity();
});
ctx.panel.button("pause", () => {
  paused = !paused;
});
ctx.panel.button("shuffle phases", () => {
  phaseSeed++;
  shufflePhases();
});
ctx.panel.button("focus next group", () => {
  focusIndex = (focusIndex + 1) % GROUP_SPECS.length;
  focusCamera(GROUP_SPECS[focusIndex]!);
});
ctx.panel.button("toggle auto orbit", () => {
  autoOrbit = !autoOrbit;
});

applyDensity();
focusCamera(GROUP_SPECS[focusIndex]!);

onBeforeRender(ctx.scene, (deltaMs) => {
  const deltaSeconds = deltaMs * 0.001;
  if (!paused) {
    timeSeconds += deltaSeconds;
    for (const group of groups) group.characters.update(deltaSeconds);
    updateCrowdTransforms(timeSeconds);
  }
  const camera = ctx.scene.camera;
  if (autoOrbit && isArcRotateCamera(camera)) {
    camera.alpha += deltaSeconds * 0.035;
  }
  updateTelemetry();
});

await runExample(ctx);

async function createCrowdGroup(spec: GroupSpec): Promise<CrowdGroup> {
  const container = await loadGltf(ctx.engine, UNARMED_URL);
  const root = container.entities[0];
  if (!isSceneNode(root)) {
    throw new Error(`${spec.label}: Unarmed.glb did not provide a scene-node root.`);
  }
  const animations = selectAnimations(container.animationGroups ?? [], spec.clips, spec.label);
  // Add only the hierarchy. Adding the container would also register all 64
  // source clips with the scene animation manager, which VAT does not need.
  addToScene(ctx.scene, root);
  const characters = createVatCharacterSet(ctx.engine, root, animations, {
    capacity: GROUP_CAPACITY,
    engine: ctx.engine,
    visibleStrategy: "scale-zero"
  });
  const members: CrowdMember[] = [];
  for (let index = 0; index < GROUP_CAPACITY; index++) {
    const member = createMember(spec, characters, index);
    member.id = characters.create({
      transform: getTransform(spec.kind, member, 0),
      clip: member.clip,
      offset: member.phaseSeconds,
      fps: member.fps
    });
    members.push(member);
  }
  return { spec, characters, members };
}

function createMember(spec: GroupSpec, characters: VatCharacterSet, index: number): CrowdMember {
  const seed = hash01(index + GROUP_SPECS.indexOf(spec) * 1009);
  const clip = spec.clips[index % spec.clips.length]!;
  const clipData = characters.clips[clip];
  if (!clipData) throw new Error(`${spec.label}: VAT clip \"${clip}\" was not baked.`);
  const duration = clipData.frameCount / clipData.fps;
  return {
    id: -1 as InstanceId,
    index,
    layoutIndex: (index * 137) % GROUP_CAPACITY,
    lane: ((index * 137) % GROUP_CAPACITY) % VANGUARD_LANES,
    seed,
    speed: spec.kind === "vanguard" ? 4.2 + seed * 2.2 : 0.25 + seed * 0.3,
    clip,
    phaseSeconds: hash01(index * 17 + 13) * duration,
    fps: clipData.fps * (0.97 + hash01(index * 31 + 7) * 0.06)
  };
}

function createArena(): void {
  const ground = createGround(ctx.engine, { width: 200, height: 200, subdivisions: 2 });
  ground.material = createPbrMaterial({
    baseColorFactor: [0.025, 0.032, 0.05, 1],
    metallicFactor: 0.3,
    roughnessFactor: 0.66,
    environmentIntensity: 0.7
  });
  addToScene(ctx.scene, ground);

  const rings: Array<readonly [number, readonly [number, number, number]]> = [
    [52, [0.1, 0.64, 1]],
    [82, [0.84, 0.2, 0.45]],
    [118, [0.96, 0.64, 0.15]]
  ];
  for (const [diameter, color] of rings) {
    const ring = createTorus(ctx.engine, { diameter, thickness: 0.1, tessellation: 96 });
    ring.position.y = 0.025;
    ring.rotationQuaternion.set(Math.SQRT1_2, 0, 0, Math.SQRT1_2);
    ring.material = createPbrMaterial({
      baseColorFactor: [color[0], color[1], color[2], 1],
      emissiveColor: [color[0], color[1], color[2]],
      metallicFactor: 0.2,
      roughnessFactor: 0.35
    });
    addToScene(ctx.scene, ring);
  }
}

function updateCrowdTransforms(time: number): void {
  const activeCount = visiblePerGroup();
  for (const group of groups) {
    group.characters.primary.set.batch((writer) => {
      for (let index = 0; index < activeCount; index++) {
        const member = group.members[index];
        if (member) writer.setMatrix(member.id, getTransform(group.spec.kind, member, time));
      }
    });
  }
}

function getTransform(kind: GroupKind, member: CrowdMember, time: number): Mat4 {
  switch (kind) {
    case "vanguard": {
      const lapDistance = 176;
      const progress = positiveModulo(member.seed * lapDistance + time * member.speed, lapDistance);
      const z = -88 + progress;
      const laneCenter = (member.lane - (VANGUARD_LANES - 1) * 0.5) * 22;
      const laneMember = Math.floor(member.layoutIndex / VANGUARD_LANES);
      const column = laneMember % 10;
      const row = Math.floor(laneMember / 10);
      const wave = Math.sin(progress * 0.065 + member.seed * 8) * 6;
      const x = laneCenter + (column - 4.5) * 3.4 + wave;
      const yaw = Math.PI + Math.sin(progress * 0.065 + member.seed * 8) * 0.34;
      return makeCharacterMatrix(x, 0, z + (row - 4.5) * 2.8, yaw);
    }
    case "melee": {
      const columns = 32;
      const row = Math.floor(member.layoutIndex / columns);
      const column = member.layoutIndex % columns;
      const rows = Math.ceil(GROUP_CAPACITY / columns);
      const side = row % 2 === 0 ? 1 : -1;
      const baseX = (column - (columns - 1) * 0.5) * 4 + side * 1.1;
      const baseZ = (row - (rows - 1) * 0.5) * 4.2;
      const beat = time * member.speed * 3 + member.seed * 9;
      return makeCharacterMatrix(baseX + Math.sin(beat) * 0.22, 0, baseZ + Math.cos(beat * 0.7) * 0.18, side > 0 ? Math.PI : 0);
    }
    case "sentries": {
      const perRing = 200;
      const ringIndex = Math.floor(member.layoutIndex / perRing);
      const slot = member.layoutIndex % perRing;
      const baseAngle = (slot / perRing) * Math.PI * 2 + ringIndex * 0.13;
      const angle = baseAngle + Math.sin(time * member.speed + member.seed * 12) * 0.018;
      const radius = 52 + ringIndex * 9 + Math.sin(member.seed * 20) * 1.2;
      const sway = Math.sin(time * member.speed * 2 + member.seed * 8) * 0.35;
      return makeCharacterMatrix(Math.cos(angle) * radius - Math.sin(angle) * sway, 0, Math.sin(angle) * radius + Math.cos(angle) * sway, angle + Math.PI * 0.5);
    }
  }
}

function makeCharacterMatrix(x: number, y: number, z: number, yaw: number): Mat4 {
  return composeMat4({
    position: [x, y, z],
    rotationEuler: [0, yaw, 0],
    scale: MODEL_SCALE
  });
}

function applyDensity(): void {
  const perGroup = visiblePerGroup();
  for (const group of groups) {
    group.characters.primary.set.batch((writer) => {
      for (let index = 0; index < group.members.length; index++) {
        const member = group.members[index];
        if (member) writer.setVisible(member.id, index < perGroup);
      }
    });
  }
}

function shufflePhases(): void {
  const activeCount = visiblePerGroup();
  for (const group of groups) {
    for (let index = 0; index < activeCount; index++) {
      const member = group.members[index];
      if (!member) continue;
      const clip = group.characters.clips[member.clip];
      if (!clip) continue;
      group.characters.setPhaseOffset(member.id, hash01(member.index * 19 + phaseSeed * 997) * (clip.frameCount / clip.fps));
    }
  }
}

function focusCamera(spec: GroupSpec): void {
  const camera = ctx.scene.camera;
  if (!isArcRotateCamera(camera)) return;
  camera.radius = spec.cameraRadius;
  camera.target.x = spec.focus[0];
  camera.target.y = spec.focus[1];
  camera.target.z = spec.focus[2];
}

function updateTelemetry(): void {
  const visible = groups.reduce((total, group) => total + group.characters.visibleCount, 0);
  ctx.panel.set("asset", "Unarmed.glb (local)");
  ctx.panel.set("crowd", `${groups.reduce((total, group) => total + group.characters.count, 0)} total / ${visible} visible`);
  ctx.panel.set("groups", `${visiblePerGroup()} vanguard / ${visiblePerGroup()} melee / ${visiblePerGroup()} sentries`);
  ctx.panel.set("clips", "9 selected / 64 source");
  ctx.panel.set("density", DENSITIES[densityIndex] ?? 900);
  ctx.panel.set("focus", GROUP_SPECS[focusIndex]?.label ?? "Arena");
  ctx.panel.set("motion", paused ? "paused" : autoOrbit ? "playing + orbit" : "playing");
  ctx.panel.set("status", "running");
}

function visiblePerGroup(): number {
  return (DENSITIES[densityIndex] ?? DEFAULT_DENSITY) / groups.length;
}

function selectAnimations<T extends { name: string }>(animations: readonly T[], names: readonly string[], label: string): T[] {
  const byName = new Map(animations.map((animation) => [animation.name, animation]));
  return names.map((name) => {
    const animation = byName.get(name);
    if (!animation) throw new Error(`${label}: Unarmed.glb is missing required clip \"${name}\".`);
    return animation;
  });
}

function hash01(value: number): number {
  const hashed = Math.sin(value * 12.9898) * 43758.5453123;
  return hashed - Math.floor(hashed);
}

function positiveModulo(value: number, divisor: number): number {
  return ((value % divisor) + divisor) % divisor;
}

function isSceneNode(value: unknown): value is SceneNode {
  return typeof value === "object" && value !== null && "children" in value && "worldMatrix" in value;
}

function isArcRotateCamera(value: unknown): value is ArcRotateCamera {
  return typeof value === "object" && value !== null && "radius" in value && "target" in value;
}
