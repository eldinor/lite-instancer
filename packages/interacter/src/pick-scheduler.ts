import {
  createGpuPicker,
  disposePicker,
  pickAsync,
  type GpuPicker,
  type Mesh,
  type SceneContext
} from "@babylonjs/lite";

export interface PickResult {
  pickedMesh: Mesh | null;
  pickedPoint: readonly [number, number, number] | null;
  distance: number | null;
}

export interface PickDriver {
  pick(x: number, y: number, filter: (mesh: Mesh) => boolean): Promise<PickResult>;
  dispose(): void;
}

export interface FrameDriver {
  request(callback: () => void): number;
  cancel(handle: number): void;
}

interface PickJob {
  x: number;
  y: number;
  filter: (mesh: Mesh) => boolean;
  resolve(result: PickResult): void;
  reject(error: unknown): void;
}

export class PickScheduler {
  readonly #driver: PickDriver;
  readonly #frames: FrameDriver;
  readonly #discrete: PickJob[] = [];
  #pendingHover: PickJob | undefined;
  #hoverReady = false;
  #frameHandle: number | undefined;
  #busy = false;
  #disposed = false;
  #driverDisposed = false;

  constructor(driver: PickDriver, frames: FrameDriver) {
    this.#driver = driver;
    this.#frames = frames;
  }

  queueDiscrete(job: PickJob): void {
    if (this.#disposed) return;
    this.#discrete.push(job);
    this.#pump();
  }

  queueHover(job: PickJob): void {
    if (this.#disposed) return;
    this.#pendingHover = job;
    this.#scheduleHoverFrame();
  }

  cancelPending(): void {
    this.#discrete.length = 0;
    this.#pendingHover = undefined;
    this.#hoverReady = false;
    if (this.#frameHandle !== undefined) {
      this.#frames.cancel(this.#frameHandle);
      this.#frameHandle = undefined;
    }
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    this.cancelPending();
    if (!this.#busy) this.#disposeDriver();
  }

  #scheduleHoverFrame(): void {
    if (this.#frameHandle !== undefined || this.#hoverReady) return;
    this.#frameHandle = this.#frames.request(() => {
      this.#frameHandle = undefined;
      this.#hoverReady = true;
      this.#pump();
    });
  }

  #pump(): void {
    if (this.#busy || this.#disposed) return;
    let job = this.#discrete.shift();
    if (!job && this.#hoverReady && this.#pendingHover) {
      job = this.#pendingHover;
      this.#pendingHover = undefined;
      this.#hoverReady = false;
    }
    if (!job) return;

    this.#busy = true;
    void this.#driver
      .pick(job.x, job.y, job.filter)
      .then(job.resolve, job.reject)
      .finally(() => {
        this.#busy = false;
        if (this.#disposed) {
          this.#disposeDriver();
          return;
        }
        if (this.#pendingHover && !this.#hoverReady) this.#scheduleHoverFrame();
        this.#pump();
      });
  }

  #disposeDriver(): void {
    if (this.#driverDisposed) return;
    this.#driverDisposed = true;
    this.#driver.dispose();
  }
}

export function createBabylonPickDriver(scene: SceneContext): PickDriver {
  const picker: GpuPicker = createGpuPicker(scene);
  return {
    async pick(x, y, filter) {
      const result = await pickAsync(picker, x, y, { filter });
      return {
        pickedMesh: result.hit ? (result.pickedMesh as Mesh | null) : null,
        pickedPoint: result.pickedPoint,
        distance: result.hit ? result.distance : null
      };
    },
    dispose() {
      disposePicker(picker);
    }
  };
}

export function createBrowserFrameDriver(): FrameDriver {
  return {
    request(callback) {
      return requestAnimationFrame(callback);
    },
    cancel(handle) {
      cancelAnimationFrame(handle);
    }
  };
}

