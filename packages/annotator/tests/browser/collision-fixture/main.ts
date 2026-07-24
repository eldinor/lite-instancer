import {
  createAnnotationLayer,
  createLabel,
  disposeAnnotation,
  disposeAnnotationLayer,
  getAnnotationSnapshot,
  setAnnotationAnchor,
  updateAnnotationLayer
} from "../../../src/index.js";
import { createHtmlAnnotationBackend } from "../../../src/html.js";
import type { Camera } from "@babylonjs/lite";
import type { LabelHandle } from "../../../src/types.js";

const container = document.querySelector<HTMLElement>("#container")!;
const canvas = document.querySelector<HTMLCanvasElement>("#canvas")!;
const identity = () => new Float32Array([
  1, 0, 0, 0,
  0, 1, 0, 0,
  0, 0, 1, 0,
  0, 0, 0, 1
]);
const camera = {
  worldMatrix: identity(),
  worldMatrixVersion: 1,
  fov: Math.PI / 3,
  nearPlane: 0.1,
  farPlane: 100,
  _viewVer: -1,
  _projVer: -1,
  _vpVer: -1,
  _projAspect: -1,
  _vpAspect: -1,
  _viewCache: identity(),
  _projCache: identity(),
  _vpCache: identity()
} as unknown as Camera;
const layer = createAnnotationLayer({
  scene: {} as never,
  camera,
  canvas,
  backend: createHtmlAnnotationBackend({ container })
});
const style = {
  color: "#ffffff",
  backgroundColor: "#10251f",
  padding: 8,
  borderColor: "#58e6bd",
  borderWidth: 1,
  borderRadius: 6
};
const lower = createLabel(layer, {
  anchor: { kind: "world", position: [0, 0, 3] },
  text: "Lower priority",
  collision: "hide",
  zIndex: 1,
  style
});
const higher = createLabel(layer, {
  anchor: { kind: "world", position: [0, 0, 3] },
  text: "Higher priority",
  collision: "hide",
  zIndex: 2,
  style
});
let shiftObstacle: LabelHandle | undefined;
let shifted: LabelHandle | undefined;

updateAnnotationLayer(layer);

declare global {
  interface Window {
    collisionFixture: {
      separate(): void;
      snapshots(): ReturnType<typeof getAnnotationSnapshot>[];
      showShiftScenario(): void;
      shiftSnapshots(): ReturnType<typeof getAnnotationSnapshot>[];
      dispose(): void;
    };
  }
}

window.collisionFixture = {
  separate() {
    setAnnotationAnchor(higher, { kind: "world", position: [3, 0, 3] });
    updateAnnotationLayer(layer);
  },
  snapshots: () => [getAnnotationSnapshot(lower), getAnnotationSnapshot(higher)],
  showShiftScenario() {
    disposeAnnotation(lower);
    disposeAnnotation(higher);
    shiftObstacle = createLabel(layer, {
      anchor: { kind: "world", position: [0, 0, 3] },
      text: "Fixed obstacle",
      style
    });
    shifted = createLabel(layer, {
      anchor: { kind: "world", position: [0, 0, 3] },
      text: "Shifted label",
      collision: "shift",
      collisionMaxShift: 96,
      leaderLine: { color: "#58e6bd", width: 2, opacity: 0.8, minLength: 8 },
      style
    });
    updateAnnotationLayer(layer);
  },
  shiftSnapshots: () => shiftObstacle && shifted
    ? [getAnnotationSnapshot(shiftObstacle), getAnnotationSnapshot(shifted)]
    : [],
  dispose: () => disposeAnnotationLayer(layer)
};
