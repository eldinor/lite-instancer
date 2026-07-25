import { addToScene, loadGltf, type SceneNode } from "@babylonjs/lite";
import {
  createAnimator,
  disposeAnimator,
  onAnimatorEvent,
  pauseAnimator,
  playAnimation,
  resumeAnimator,
  setAnimatorSpeed,
  setPlaybackNormalizedTime,
  stopAnimation,
  type AnimationPlayback,
  type Animator
} from "@litools/animator";
import { createExampleApp } from "../shared/app.js";

const MODEL_URL = "https://assets.babylonjs.com/meshes/HVGirl.glb";
const CHARACTER_SCALE = 0.1;
const app = await createExampleApp(
  "Samba Girl Playback Lab",
  "Playback promises, looping, cancellation, AbortSignal, pause, speed, seek, snapshots, and disposal."
);
app.camera.radius = 10;
app.camera.alpha += Math.PI;
app.camera.target.x = 0;
app.camera.target.y = 0.9;
app.camera.target.z = 0;
app.panel.set("model normalization", `${CHARACTER_SCALE}x root scale`);
app.panel.set("asset", "HVGirl.glb · Babylon assets");

const container = await loadGltf(app.engine, MODEL_URL);
const root = container.entities[0];
if (!isSceneNode(root)) {
  throw new Error("HVGirl.glb did not provide a scene-node root.");
}
root.scaling.set(CHARACTER_SCALE, CHARACTER_SCALE, CHARACTER_SCALE);
addToScene(app.scene, container);
const groups = container.animationGroups ?? [];
if (!groups.some((group) => group.name === "Samba")) {
  throw new Error('HVGirl.glb is missing the expected "Samba" clip.');
}

let animator: Animator | undefined;
let playback: AnimationPlayback | undefined;
let abortController: AbortController | undefined;
let loop = false;
let paused = false;

function create(): void {
  animator = createAnimator({
    engine: app.engine,
    clips: groups,
    aliases: { dance: "Samba" },
    update: { mode: "scene", scene: app.scene }
  });
  onAnimatorEvent(animator, (event) => {
    const detail = event.result
      ? `${event.result.status} @ ${event.result.elapsed.toFixed(2)}s`
      : event.type;
    app.panel.log(`${event.playback.clipId}: ${detail}`);
  });
  app.panel.set("animator", animator.id);
  app.panel.set("loop", loop);
  app.panel.set("paused", false);
}

async function start(restart = false): Promise<void> {
  if (!animator) create();
  playback = playAnimation(animator!, "dance", { loop, restart });
  app.panel.set("handle", playback.id);
  const result = await playback.finished;
  app.panel.set("last result", `${result.status} (${result.elapsed.toFixed(2)}s)`);
}

create();
app.watchAnimator(() => animator);
app.panel.button("play + await", () => start());
app.panel.button("restart", () => start(true));
app.panel.button("toggle loop", () => {
  loop = !loop;
  app.panel.set("loop", loop);
  void start(true);
});
app.panel.button("pause / resume", () => {
  if (!animator) return;
  paused = !paused;
  if (paused) pauseAnimator(animator);
  else resumeAnimator(animator);
  app.panel.set("paused", paused);
});
app.panel.button("seek 50%", () => {
  if (playback) setPlaybackNormalizedTime(playback, 0.5);
});
app.panel.button("cancel handle", () => playback?.cancel("cancel-button"));
app.panel.button("stop clip", () => animator && stopAnimation(animator, "dance"));
app.panel.button("AbortSignal play", () => {
  if (!animator) return;
  abortController = new AbortController();
  playback = playAnimation(animator, "dance", {
    loop: true,
    restart: true,
    signal: abortController.signal
  });
  app.panel.log("AbortSignal playback started");
});
app.panel.button("abort signal", () => abortController?.abort("abort-button"));
app.panel.button("dispose", () => {
  if (!animator) return;
  disposeAnimator(animator);
  app.panel.log("Animator disposed; callbacks stopped");
  animator = undefined;
  playback = undefined;
});
app.panel.button("recreate", () => {
  if (animator) disposeAnimator(animator);
  create();
  app.panel.log("Animator recreated with the same groups");
});
app.panel.range("animator speed", 0.25, 2, 0.05, 1, (value) => {
  if (animator) setAnimatorSpeed(animator, value);
});
app.panel.range("playback speed", 0.25, 2, 0.05, 1, (value) => {
  playback?.setSpeed(value);
});

await app.start();

function isSceneNode(value: unknown): value is SceneNode {
  return typeof value === "object" && value !== null && "children" in value;
}
