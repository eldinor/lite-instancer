import type {
  AnnotationBackend,
  AnnotationViewport,
  BackendAnnotationDefinition,
  BackendAnnotationUpdate,
  BackendBounds
} from "../../src/types.js";

export interface FakeResource {
  definition: BackendAnnotationDefinition;
  update: BackendAnnotationUpdate | undefined;
  disposed: boolean;
  updates: number;
}

export class FakeBackend implements AnnotationBackend {
  readonly resources: FakeResource[] = [];
  viewport: AnnotationViewport | undefined;
  disposed = false;
  bounds: BackendBounds = { x: 40, y: 45, width: 20, height: 10 };

  create(definition: BackendAnnotationDefinition): FakeResource {
    const resource: FakeResource = { definition, update: undefined, disposed: false, updates: 0 };
    this.resources.push(resource);
    return resource;
  }

  update(resource: unknown, update: BackendAnnotationUpdate): void {
    const target = resource as FakeResource;
    target.update = update;
    target.updates++;
  }

  measure(resource: unknown): BackendBounds | null {
    const update = (resource as FakeResource).update;
    if (!update?.rendered || !update.screenPosition) return null;
    return {
      x: update.screenPosition.x - this.bounds.width * 0.5,
      y: update.screenPosition.y - this.bounds.height * 0.5,
      width: this.bounds.width,
      height: this.bounds.height
    };
  }

  setViewport(viewport: AnnotationViewport): void {
    this.viewport = viewport;
  }

  disposeResource(resource: unknown): void {
    (resource as FakeResource).disposed = true;
  }

  dispose(): void {
    this.disposed = true;
  }
}

export function fakeCanvas(width = 100, height = 100): HTMLCanvasElement {
  return {
    width,
    height,
    clientWidth: width,
    clientHeight: height,
    getBoundingClientRect: () => ({
      x: 0,
      y: 0,
      left: 0,
      top: 0,
      right: width,
      bottom: height,
      width,
      height,
      toJSON: () => ({})
    })
  } as unknown as HTMLCanvasElement;
}
