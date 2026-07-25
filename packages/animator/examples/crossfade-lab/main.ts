import { addToScene, loadGltf } from "@babylonjs/lite";
import {
  createAnimator,
  getAnimatorSnapshot,
  onAnimatorEvent,
  pauseAnimator,
  playAnimation,
  resumeAnimator,
  setAnimatorSpeed,
  setPlaybackNormalizedTime,
  type AnimationPlayback
} from "@litools/animator";
import { createExampleApp } from "../shared/app.js";

type ClipId = "idle" | "walk" | "run" | "jump" | "action";

const MODEL = {
  label: "Ready Player",
  asset: "all-anim.glb · ForBJS",
  url: "https://raw.githubusercontent.com/eldinor/ForBJS/master/all-anim.glb",
  cameraRadius: 2.8,
  cameraTargetY: 0.95,
  aliases: {
    idle: "Idle",
    walk: "Walk",
    run: "Run",
    jump: "Jump",
    action: "Greeting"
  } satisfies Readonly<Record<ClipId, string>>
} as const;

const app = await createExampleApp(
  "Ready Player Crossfade Lab",
  "Normalized locomotion crossfades, rapid interruption, one-shots, cancellation, pause, camera framing, and live transition weights."
);
const presentationAlpha = app.camera.alpha + Math.PI;
let cameraRadiusInput: HTMLInputElement | undefined;

function resetCamera(): void {
  app.camera.alpha = presentationAlpha;
  app.camera.radius = MODEL.cameraRadius;
  app.camera.target.x = 0;
  app.camera.target.y = MODEL.cameraTargetY;
  app.camera.target.z = 0;
  if (cameraRadiusInput) {
    cameraRadiusInput.value = String(MODEL.cameraRadius);
    cameraRadiusInput.dispatchEvent(new Event("input"));
  }
  app.panel.set(
    "camera",
    `radius ${MODEL.cameraRadius.toFixed(1)} · target y ${MODEL.cameraTargetY}`
  );
}

resetCamera();
app.panel.set("asset", MODEL.asset);
app.panel.set("model", MODEL.label);
app.panel.set("action clip", `greeting (${MODEL.aliases.action})`);
app.panel.set("known clips", Object.keys(MODEL.aliases).join(", "));

const container = await loadGltf(app.engine, MODEL.url);
const groups = container.animationGroups ?? [];
for (const sourceName of Object.values(MODEL.aliases)) {
  if (!groups.some((group) => group.name === sourceName)) {
    throw new Error(`${MODEL.asset} is missing expected clip "${sourceName}".`);
  }
}
addToScene(app.scene, container);

const animator = createAnimator({
  engine: app.engine,
  clips: groups,
  aliases: MODEL.aliases,
  update: { mode: "scene", scene: app.scene },
  autoplay: "idle"
});
let fadeDuration = 0.35;
let current: AnimationPlayback | undefined;
let paused = false;
let sequenceGeneration = 0;

onAnimatorEvent(animator, (event) => {
  app.panel.log(
    `${event.type}: ${event.playback.clipId}${
      event.result ? ` (${event.result.elapsed.toFixed(2)}s)` : ""
    }`
  );
});

function startCrossfade(clipId: ClipId, loop = true): AnimationPlayback {
  const synchronizeLocomotion =
    (clipId === "walk" || clipId === "run") &&
    (current?.clipId === "walk" || current?.clipId === "run") &&
    (current.state === "playing" || current.state === "paused");
  current = playAnimation(animator, clipId, {
    loop,
    restart: !loop,
    interruption: "crossfade",
    fadeIn: fadeDuration,
    syncNormalizedTime: synchronizeLocomotion
  });
  return current;
}

function crossfade(clipId: ClipId, loop = true): AnimationPlayback {
  sequenceGeneration += 1;
  return startCrossfade(clipId, loop);
}

function oneShot(clipId: "jump" | "action"): void {
  const generation = ++sequenceGeneration;
  const oneShotPlayback = startCrossfade(clipId, false);
  void oneShotPlayback.finished.then((result) => {
    if (result.status === "completed" && generation === sequenceGeneration) {
      startCrossfade("idle");
    }
  });
}

async function playWalkJumpWalkIdleSequence(): Promise<void> {
  const generation = ++sequenceGeneration;
  app.panel.set("sequence", "walk");
  app.panel.log("SEQUENCE · walk");
  if ((await startCrossfade("walk", false).finished).status !== "completed") return;
  if (generation !== sequenceGeneration) return;

  app.panel.set("sequence", "jump");
  app.panel.log("SEQUENCE · jump");
  if ((await startCrossfade("jump", false).finished).status !== "completed") return;
  if (generation !== sequenceGeneration) return;

  app.panel.set("sequence", "walk");
  app.panel.log("SEQUENCE · walk");
  if ((await startCrossfade("walk", false).finished).status !== "completed") return;
  if (generation !== sequenceGeneration) return;

  startCrossfade("idle");
  app.panel.set("sequence", "idle");
  app.panel.log("SEQUENCE · idle");
}

app.watchAnimator(() => animator);
app.panel.button("reset camera", resetCamera);
app.panel.button("idle", () => crossfade("idle"));
app.panel.button("walk", () => crossfade("walk"));
app.panel.button("run", () => crossfade("run"));
app.panel.button("jump one-shot", () => oneShot("jump"));
app.panel.button("greeting one-shot", () => oneShot("action"));
app.panel.button("walk → jump → walk → idle", playWalkJumpWalkIdleSequence);
app.panel.button("replace with idle", () => {
  sequenceGeneration += 1;
  current = playAnimation(animator, "idle", {
    loop: true,
    restart: true,
    interruption: "replace"
  });
});
app.panel.button("rapid idle→walk→run→idle", () => {
  crossfade("idle");
  setTimeout(() => crossfade("walk"), 120);
  setTimeout(() => crossfade("run"), 240);
  setTimeout(() => crossfade("idle"), 360);
});
app.panel.button("pause / resume", () => {
  paused = !paused;
  if (paused) pauseAnimator(animator);
  else resumeAnimator(animator);
  app.panel.set("paused", paused);
});
app.panel.button("cancel destination", () => {
  sequenceGeneration += 1;
  current?.cancel("crossfade-demo");
  app.panel.set("sequence", "cancelled");
});
app.panel.button("restart at 50%", () => {
  current = crossfade("walk");
  setPlaybackNormalizedTime(current, 0.5);
});
app.panel.range("fade seconds", 0.05, 1.5, 0.05, fadeDuration, (value) => {
  fadeDuration = value;
});
app.panel.range("animation speed", 0.25, 2, 0.05, 1, (value) => {
  setAnimatorSpeed(animator, value);
  app.panel.set("speed", `${value.toFixed(2)}×`);
});
cameraRadiusInput = app.panel.range(
  "camera distance",
  1.5,
  10,
  0.1,
  MODEL.cameraRadius,
  (value) => {
    app.camera.radius = value;
    app.panel.set("camera", `radius ${value.toFixed(1)} · target y ${MODEL.cameraTargetY}`);
  }
);

app.panel.set("paused", false);
app.panel.set("speed", "1.00×");
app.panel.set("sequence", "inactive");
app.panel.set("locomotion phase sync", "walk ↔ run");
setInterval(() => {
  const snapshot = getAnimatorSnapshot(animator);
  app.panel.set(
    "weights",
    snapshot.activePlaybacks
      .map((playback) => `${playback.clipId}:${playback.weight.toFixed(2)}`)
      .join(" + ") || "none"
  );
}, 120);

await app.start();
