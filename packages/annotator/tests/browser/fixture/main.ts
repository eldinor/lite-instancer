import { createHtmlAnnotationBackend } from "../../../src/html.js";
import type {
  AnnotationBackend,
  BackendAnnotationDefinition,
  BackendBounds
} from "../../../src/types.js";

const container = document.querySelector<HTMLElement>("#container")!;
const canvas = document.querySelector<HTMLCanvasElement>("#canvas")!;
const activations: Array<{ id: number; eventType: string }> = [];
const backend = createHtmlAnnotationBackend({
  container,
  rootClassName: "fixture-root",
  onLabelActivate(annotationId, event) {
    activations.push({ id: annotationId, eventType: event.type });
  }
});

const labelDefinition: BackendAnnotationDefinition = {
  id: 1 as never,
  type: "label",
  text: "Pump A-12",
  zIndex: 4,
  style: {
    color: "#ffffff",
    backgroundColor: "#243447",
    padding: 4,
    borderRadius: 3,
    opacityTransitionDuration: 180,
    className: "fixture-label"
  },
  ariaLabel: "Pump A-12 status",
  role: "note"
};
const markerDefinition: BackendAnnotationDefinition = {
  id: 2 as never,
  type: "marker",
  shape: "ring",
  size: 18,
  zIndex: 3,
  style: { color: "#00ff88", borderWidth: 2 }
};
const label = backend.create(labelDefinition);
const marker = backend.create(markerDefinition);

function align(): void {
  const rect = canvas.getBoundingClientRect();
  backend.setViewport({ left: rect.left, top: rect.top, width: rect.width, height: rect.height });
  backend.update(label, {
    ...labelDefinition,
    definitionChanged: true,
    rendered: true,
    screenPosition: { x: 100, y: 50 }
  });
  backend.update(marker, {
    ...markerDefinition,
    definitionChanged: true,
    rendered: true,
    screenPosition: { x: 30, y: 30 }
  });
}

align();

declare global {
  interface Window {
    annotatorFixture: {
      backend: AnnotationBackend;
      align(): void;
      measureLabel(): BackendBounds | null;
      moveLabel(x: number, y: number): BackendBounds | null;
      changeLabelText(text: string): BackendBounds | null;
      activations(): ReadonlyArray<{ id: number; eventType: string }>;
      dispose(): void;
    };
  }
}

window.annotatorFixture = {
  backend,
  align,
  measureLabel: () => backend.measure(label),
  moveLabel(x, y) {
    backend.update(label, {
      ...labelDefinition,
      definitionChanged: false,
      rendered: true,
      screenPosition: { x, y }
    });
    return backend.measure(label);
  },
  changeLabelText(text) {
    backend.update(label, {
      ...labelDefinition,
      text,
      definitionChanged: true,
      rendered: true,
      screenPosition: { x: 120, y: 60 }
    });
    return backend.measure(label);
  },
  activations: () => activations,
  dispose: () => backend.dispose()
};
