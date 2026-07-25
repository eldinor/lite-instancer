import {
  addToScene,
  createSphere,
  createStandardMaterial,
  enableMaterialTracking,
  loadGltf,
  onBeforeRender
} from "@babylonjs/lite";
import {
  createAnimator,
  defineAnimationMarkers,
  disposeAnimator,
  marker,
  onAnimationMarker,
  onAnimatorEvent,
  playAnimation,
  setAnimatorSpeed,
  setPlaybackNormalizedTime,
  updateAnimator,
  type AnimationPlayback,
  type Animator
} from "@litools/animator";
import { createExampleApp } from "../shared/app.js";

const MODEL_URL = "/Unarmed.glb";
const aliases = {
  idle: "UnarmedIdle",
  alert: "UnarmedIdleAlert1",
  walk: "UnarmedWalkInjured",
  run: "UnarmedRunForward",
  jump: "UnarmedJump",
  strafeLeft: "UnarmedStrafeLeft",
  strafeRight: "UnarmedStrafeRight",
  attackLeft: "UnarmedAttackL1",
  attackRight: "UnarmedAttackR1",
  block: "UnarmedBlock",
  hit: "UnarmedGetHitF1"
} as const;

const app = await createExampleApp(
  "Unarmed Marker + Manual Update Lab",
  "Manual stepping, dropped-frame marker crossings, loops, once markers, silent seek, unsubscription, and disposal safety."
);
app.camera.alpha += Math.PI;
app.camera.radius = 4.5;
app.camera.target.y = 1;
app.panel.set("asset", "Unarmed.glb · local repository asset");

const container = await loadGltf(app.engine, MODEL_URL);
addToScene(app.scene, container);
const groups = container.animationGroups ?? [];
for (const sourceName of Object.values(aliases)) {
  if (!groups.some((group) => group.name === sourceName)) {
    throw new Error(`Unarmed.glb is missing expected clip "${sourceName}".`);
  }
}

let animator: Animator;
let current: AnimationPlayback | undefined;
let automatic = true;
let animatorSpeed = 1;
let sequenceGeneration = 0;
let markerSubscriptionActive = true;
let unsubscribeMarkers = (): void => undefined;
const leftIndicator = indicator(-0.35, [0.15, 0.35, 0.55]);
const rightIndicator = indicator(0.35, [0.15, 0.35, 0.55]);
await Promise.all([
  enableMaterialTracking(leftIndicator.material),
  enableMaterialTracking(rightIndicator.material)
]);
const footstepPalettes = {
  walk: {
    left: [0.25, 1, 0.35],
    right: [1, 0.85, 0.2],
    leftRest: [0.08, 0.28, 0.1],
    rightRest: [0.3, 0.24, 0.06]
  },
  run: {
    left: [0.2, 0.9, 1],
    right: [1, 0.4, 0.12],
    leftRest: [0.05, 0.22, 0.3],
    rightRest: [0.3, 0.1, 0.04]
  }
} as const;

function create(): void {
  animator = createAnimator({
    engine: app.engine,
    clips: groups,
    aliases,
    update: { mode: "manual" },
    autoplay: "idle",
    speed: animatorSpeed
  });
  defineAnimationMarkers(animator, "run", [
    marker("right-foot", { normalizedTime: 0.38 }),
    marker("left-foot", { normalizedTime: 0.86 }),
    marker("first-stride", { normalizedTime: 0.4, once: true })
  ]);
  defineAnimationMarkers(animator, "walk", [
    marker("left-foot", { normalizedTime: 0.14 }),
    marker("right-foot", { normalizedTime: 0.54 })
  ]);
  defineAnimationMarkers(animator, "attackLeft", [
    marker("impact", { normalizedTime: 0.58 })
  ]);
  defineAnimationMarkers(animator, "attackRight", [
    marker("impact", { normalizedTime: 0.58 })
  ]);
  subscribeMarkers();
  onAnimatorEvent(animator, (event) => {
    app.panel.log(`${event.type}: ${event.playback.clipId}`);
  });
}

function subscribeMarkers(): void {
  unsubscribeMarkers();
  const removers = [
    onAnimationMarker(animator, "left-foot", (event) => {
      const palette = footstepPalette(event.clipId);
      flash(leftIndicator, palette.left, event.loopIndex);
      app.panel.log(`${event.clipId.toUpperCase()} · LEFT FOOT · loop ${event.loopIndex}`);
    }),
    onAnimationMarker(animator, "right-foot", (event) => {
      const palette = footstepPalette(event.clipId);
      flash(rightIndicator, palette.right, event.loopIndex);
      app.panel.log(`${event.clipId.toUpperCase()} · RIGHT FOOT · loop ${event.loopIndex}`);
    }),
    onAnimationMarker(animator, "first-stride", (event) => app.panel.log(`once marker: loop ${event.loopIndex}`)),
    onAnimationMarker(animator, "impact", (event) => {
      flash(leftIndicator, [1, 0.1, 0.1], event.loopIndex);
      flash(rightIndicator, [1, 0.1, 0.1], event.loopIndex);
      app.panel.log(`IMPACT ${event.clipId} @ ${event.normalizedTime.toFixed(2)}`);
    })
  ];
  unsubscribeMarkers = () => removers.splice(0).forEach((remove) => remove());
  markerSubscriptionActive = true;
  app.panel.set("marker subscription", "active");
}

function startPlayback(
  clipId: keyof typeof aliases,
  loop: boolean
): AnimationPlayback {
  if (clipId === "walk" || clipId === "run") setFootstepPalette(clipId);
  current = playAnimation(animator, clipId, {
    loop,
    restart: !loop,
    interruption: "crossfade",
    fadeIn: 0.2
  });
  return current;
}

function play(clipId: keyof typeof aliases, loop: boolean): AnimationPlayback {
  sequenceGeneration += 1;
  return startPlayback(clipId, loop);
}

async function playWalkJumpWalkIdleSequence(): Promise<void> {
  const generation = ++sequenceGeneration;
  app.panel.set("sequence", "walk");
  app.panel.log("SEQUENCE · walk");
  if ((await startPlayback("walk", false).finished).status !== "completed") return;
  if (generation !== sequenceGeneration || animator.disposed) return;

  app.panel.set("sequence", "jump");
  app.panel.log("SEQUENCE · jump");
  if ((await startPlayback("jump", false).finished).status !== "completed") return;
  if (generation !== sequenceGeneration || animator.disposed) return;

  app.panel.set("sequence", "walk");
  app.panel.log("SEQUENCE · walk");
  if ((await startPlayback("walk", false).finished).status !== "completed") return;
  if (generation !== sequenceGeneration || animator.disposed) return;

  startPlayback("idle", true);
  app.panel.set("sequence", "idle");
  app.panel.log("SEQUENCE · idle");
}

create();
app.watchAnimator(() => animator);
onBeforeRender(app.scene, (deltaMs) => {
  if (automatic && !animator.disposed) updateAnimator(animator, deltaMs / 1000);
});

app.panel.button("idle", () => play("idle", true));
app.panel.button("walk + footsteps", () => play("walk", true));
app.panel.button("run + footsteps", () => play("run", true));
app.panel.button("walk → jump → walk → idle", playWalkJumpWalkIdleSequence);
app.panel.button("attack left", () => play("attackLeft", false));
app.panel.button("attack right", () => play("attackRight", false));
app.panel.button("toggle auto update", () => {
  automatic = !automatic;
  app.panel.set("automatic update", automatic);
});
app.panel.button("step 1/60", () => {
  if (!animator.disposed) updateAnimator(animator, 1 / 60);
});
app.panel.button("large step 0.8s", () => {
  if (!animator.disposed) updateAnimator(animator, 0.8);
});
app.panel.button("silent seek 50%", () => {
  if (current) setPlaybackNormalizedTime(current, 0.5);
  app.panel.log("seeked silently to 50%");
});
app.panel.button("toggle marker subscription", () => {
  if (markerSubscriptionActive) {
    unsubscribeMarkers();
    markerSubscriptionActive = false;
    app.panel.set("marker subscription", "removed");
  } else {
    subscribeMarkers();
  }
});
app.panel.button("cancel current", () => {
  sequenceGeneration += 1;
  current?.cancel("marker-lab");
  app.panel.set("sequence", "cancelled");
});
app.panel.button("dispose", () => {
  sequenceGeneration += 1;
  disposeAnimator(animator);
  app.panel.log("disposed: future updates and markers stopped");
});
app.panel.button("recreate", () => {
  sequenceGeneration += 1;
  if (!animator.disposed) disposeAnimator(animator);
  create();
  app.panel.log("manual Animator recreated");
});
app.panel.range("animation speed", 0.25, 2, 0.05, animatorSpeed, (value) => {
  animatorSpeed = value;
  if (!animator.disposed) setAnimatorSpeed(animator, value);
  app.panel.set("speed", `${value.toFixed(2)}×`);
});
app.panel.set("automatic update", automatic);
app.panel.set("speed", "1.00×");
app.panel.set("sequence", "inactive");
app.panel.set("walk source", aliases.walk);
app.panel.set("marker colors", "walk: green/yellow · run: cyan/orange");
app.panel.set("walk foot phases", "left 0.14 · right 0.54");
app.panel.set("run foot phases", "right 0.38 · left 0.86");

await app.start();

function indicator(x: number, color: readonly [number, number, number]) {
  const mesh = createSphere(app.engine, { diameter: 0.14, segments: 12 });
  mesh.position.set(x, 0.08, 0.65);
  const material = createStandardMaterial();
  material.diffuseColor = [...color];
  material.emissiveColor = [...color];
  mesh.material = material;
  addToScene(app.scene, mesh);
  return { material, rest: [...color] as [number, number, number] };
}

function flash(
  indicatorState: ReturnType<typeof indicator>,
  color: readonly [number, number, number],
  loopIndex: number
): void {
  const { material } = indicatorState;
  writeColor(material.diffuseColor, color);
  writeColor(material.emissiveColor, color);
  app.panel.set("last marker loop", loopIndex);
  setTimeout(() => {
    writeColor(material.diffuseColor, indicatorState.rest);
    writeColor(material.emissiveColor, dimColor(indicatorState.rest));
  }, 130);
}

function footstepPalette(clipId: string) {
  return clipId === "walk" ? footstepPalettes.walk : footstepPalettes.run;
}

function setFootstepPalette(gait: "walk" | "run"): void {
  const palette = footstepPalettes[gait];
  setIndicatorRest(leftIndicator, palette.leftRest);
  setIndicatorRest(rightIndicator, palette.rightRest);
  app.panel.set("active footsteps", `${gait} · ${gait === "walk" ? "green/yellow" : "cyan/orange"}`);
}

function setIndicatorRest(
  indicatorState: ReturnType<typeof indicator>,
  color: readonly [number, number, number]
): void {
  indicatorState.rest = [...color];
  writeColor(indicatorState.material.diffuseColor, color);
  writeColor(indicatorState.material.emissiveColor, dimColor(color));
}

function dimColor(color: readonly [number, number, number]): [number, number, number] {
  return [color[0] * 0.6, color[1] * 0.6, color[2] * 0.6];
}

function writeColor(
  target: [number, number, number],
  color: readonly [number, number, number]
): void {
  target[0] = color[0];
  target[1] = color[1];
  target[2] = color[2];
}
