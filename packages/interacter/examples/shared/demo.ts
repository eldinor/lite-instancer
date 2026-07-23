import {
  addToScene,
  attachControl,
  createArcRotateCamera,
  createBox,
  createEngine,
  createHemisphericLight,
  createSceneContext,
  createStandardMaterial,
  registerScene,
  startEngine,
  vec3,
  type Mesh,
  type StandardMaterialProps
} from "@babylonjs/lite";
import {
  createInteractionManager,
  disposeInteractionManager,
  disposeInteractionTarget,
  isInteractionEnabled,
  onInteraction,
  onInteractionEvent,
  registerMesh,
  setInteractionEnabled,
  type InteractionEvent,
  type InteractionManager,
  type InteractionTarget
} from "@litools/interacter";
import "./styles.css";

const app = document.querySelector<HTMLDivElement>("#app");
const demo = document.body.dataset.demo;
if (!app || !demo) throw new Error("The example page is missing its app root or demo name.");

const canvas = document.createElement("canvas");
app.append(canvas);
const panel = createPanel();
document.body.append(panel.root);

const engine = await createEngine(canvas);
const scene = createSceneContext(engine);
scene.clearColor = { r: 0.025, g: 0.045, b: 0.085, a: 1 };
const camera = createArcRotateCamera(-Math.PI / 2, Math.PI / 2.5, 13, vec3(0, 0, 0));
scene.camera = camera;
addToScene(scene, camera);
addToScene(scene, createHemisphericLight([0, 1, 0], 1.25));
attachControl(camera, canvas, scene);

const left = makeBox(-2.2, [0.12, 0.55, 0.95], "Blue cube");
const right = makeBox(2.2, [0.9, 0.28, 0.42], "Red cube");
let manager: InteractionManager;
let leftTarget: InteractionTarget;
let rightTarget: InteractionTarget;
let subscriptions: Array<() => void> = [];
let stopGlobal = false;

createInteractions();
configureDemo();
await registerScene(scene);
panel.setStatus("running");
await startEngine(engine);

function createInteractions(): void {
  manager = createInteractionManager({
    scene,
    canvas,
    preventContextMenu: true,
    onError(error) {
      panel.log(`error: ${String(error)}`);
    }
  });
  leftTarget = registerMesh(manager, left);
  rightTarget = registerMesh(manager, right);
}

function configureDemo(): void {
  if (demo === "click") {
    panel.describe("Click either cube. A matching second click also emits doubleclick.");
    for (const target of [leftTarget, rightTarget]) {
      subscriptions.push(onInteraction(target, "click", (event) => panel.event(event)));
      subscriptions.push(onInteraction(target, "doubleclick", (event) => panel.event(event)));
    }
    return;
  }
  if (demo === "hover") {
    panel.describe("Move across the cubes to observe ordered hoverstart, hovermove, and hoverend events.");
    for (const target of [leftTarget, rightTarget]) {
      subscriptions.push(onInteraction(target, "hoverstart", (event) => {
        event.mesh.scaling.x = event.mesh.scaling.y = event.mesh.scaling.z = 1.18;
        panel.event(event);
      }));
      subscriptions.push(onInteraction(target, "hovermove", (event) => panel.event(event)));
      subscriptions.push(onInteraction(target, "hoverend", (event) => {
        event.mesh.scaling.x = event.mesh.scaling.y = event.mesh.scaling.z = 1;
        panel.event(event);
      }));
    }
    return;
  }
  if (demo === "pointer") {
    panel.describe("Press, release, and right-click either cube. The native context menu is disabled here.");
    for (const target of [leftTarget, rightTarget]) {
      for (const type of ["pointerdown", "pointerup", "contextmenu"] as const) {
        subscriptions.push(onInteraction(target, type, (event) => panel.event(event)));
      }
    }
    return;
  }
  if (demo === "dispatch") {
    panel.describe("Target listeners run before global listeners. Toggle propagation to skip global delivery.");
    panel.button("Toggle stopPropagation", () => {
      stopGlobal = !stopGlobal;
      panel.setStatus(stopGlobal ? "global stopped" : "global enabled");
    });
    for (const target of [leftTarget, rightTarget]) {
      subscriptions.push(onInteraction(target, "click", (event) => {
        panel.log(`target → ${event.mesh.name}`);
        if (stopGlobal) event.stopPropagation();
      }));
    }
    subscriptions.push(onInteractionEvent(manager, "click", (event) => panel.log(`global → ${event.mesh.name}`)));
    return;
  }

  panel.describe("Disable and re-enable interaction, dispose targets, or recreate the complete manager.");
  panel.button("Enable / disable", () => {
    setInteractionEnabled(manager, !isInteractionEnabled(manager));
    panel.setStatus(isInteractionEnabled(manager) ? "enabled" : "disabled");
  });
  panel.button("Dispose targets", () => {
    disposeInteractionTarget(leftTarget);
    disposeInteractionTarget(rightTarget);
    panel.setStatus("targets disposed");
  });
  panel.button("Recreate manager", () => {
    for (const unsubscribe of subscriptions) unsubscribe();
    subscriptions = [];
    disposeInteractionManager(manager);
    createInteractions();
    subscriptions.push(onInteractionEvent(manager, "click", (event) => panel.event(event)));
    panel.setStatus("manager recreated");
  });
  subscriptions.push(onInteractionEvent(manager, "click", (event) => panel.event(event)));
}

function makeBox(x: number, color: readonly [number, number, number], name: string): Mesh {
  const mesh = createBox(engine, 2.6);
  mesh.name = name;
  mesh.position.x = x;
  const material: StandardMaterialProps = createStandardMaterial();
  material.diffuseColor = [...color];
  material.specularColor = [0.12, 0.12, 0.12];
  mesh.material = material;
  addToScene(scene, mesh);
  return mesh;
}

function createPanel() {
  const root = document.createElement("section");
  root.className = "panel";
  root.innerHTML = `
    <a class="home" href="../">← Interaction examples</a>
    <h1>${document.title}</h1>
    <p class="description"></p>
    <div class="controls"></div>
    <div>Status: <span class="status">initializing</span></div>
    <pre class="log" aria-live="polite"></pre>
  `;
  root.addEventListener("pointerdown", (event) => event.stopPropagation());
  root.addEventListener("pointerup", (event) => event.stopPropagation());
  root.addEventListener("contextmenu", (event) => event.stopPropagation());
  const description = root.querySelector<HTMLElement>(".description")!;
  const controls = root.querySelector<HTMLElement>(".controls")!;
  const status = root.querySelector<HTMLElement>(".status")!;
  const log = root.querySelector<HTMLElement>(".log")!;
  const lines: string[] = [];
  return {
    root,
    describe(value: string) {
      description.textContent = value;
    },
    setStatus(value: string) {
      status.textContent = value;
    },
    log(value: string) {
      lines.unshift(value);
      log.textContent = lines.slice(0, 18).join("\n");
    },
    event(event: InteractionEvent) {
      this.log(`${event.type.padEnd(12)} ${event.mesh.name} @ ${event.canvasX.toFixed(0)}, ${event.canvasY.toFixed(0)}`);
    },
    button(label: string, callback: () => void) {
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = label;
      button.addEventListener("click", callback);
      controls.append(button);
    }
  };
}
