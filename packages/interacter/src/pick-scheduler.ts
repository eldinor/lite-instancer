import {
  createGpuPicker,
  disposePicker,
  enableDetailedPicking,
  getPickedUV,
  pickAsync,
  type GpuPicker,
  type Mesh,
  type PickOptions,
  type PickingInfo,
  type SceneContext
} from "@babylonjs/lite";
import type {
  InteractionDiagnostics,
  InteractionPickDetails,
  InteractionPickKind,
  InteractionPickOptions
} from "./types.js";

export interface PickResult {
  pickedMesh: Mesh | null;
  pickedPoint: readonly [number, number, number] | null;
  distance: number | null;
  thinInstanceIndex: number;
  detailedRequested: boolean;
  details: InteractionPickDetails | null;
}

export interface PickDriver {
  pick(
    x: number,
    y: number,
    filter: (mesh: Mesh) => boolean,
    options: InteractionPickOptions | undefined,
    detailed: boolean
  ): Promise<PickResult>;
  dispose(): void;
}

export interface FrameDriver {
  request(callback: () => void): number;
  cancel(handle: number): void;
}

export interface ClockDriver {
  now(): number;
}

interface PickJob {
  x: number;
  y: number;
  filter: (mesh: Mesh) => boolean;
  options: InteractionPickOptions | undefined;
  detailed: boolean;
  resolve(result: PickResult): void;
  reject(error: unknown): void;
}

interface ScheduledPickJob extends PickJob {
  kind: InteractionPickKind;
  queuedAt: number;
}

export class PickScheduler {
  readonly #driver: PickDriver;
  readonly #frames: FrameDriver;
  readonly #clock: ClockDriver;
  readonly #discrete: ScheduledPickJob[] = [];
  readonly #continuous = new Map<string, ScheduledPickJob>();
  readonly #immediateContinuous = new Set<string>();
  #continuousReady = false;
  #frameHandle: number | undefined;
  #busy = false;
  #disposed = false;
  #driverDisposed = false;
  #inFlightKind: InteractionPickKind | null = null;
  #completedPicks = 0;
  #failedPicks = 0;
  #coalescedHoverSamples = 0;
  #coalescedDragSamples = 0;
  #lastSchedulerWaitMs: number | null = null;
  #lastPickDurationMs: number | null = null;
  #maximumPickDurationMs: number | null = null;
  #totalPickDurationMs = 0;

  constructor(driver: PickDriver, frames: FrameDriver, clock: ClockDriver = createBrowserClockDriver()) {
    this.#driver = driver;
    this.#frames = frames;
    this.#clock = clock;
  }

  queueDiscrete(job: PickJob): void {
    if (this.#disposed) return;
    this.#discrete.push(this.#schedule(job, "discrete"));
    this.#pump();
  }

  queueHover(job: PickJob): void {
    this.queueContinuous("hover", job);
  }

  queueContinuous(key: string, job: PickJob): void {
    if (this.#disposed) return;
    if (this.#continuous.has(key)) this.#coalescedHoverSamples++;
    this.#continuous.set(key, this.#schedule(job, "hover"));
    this.#scheduleContinuousFrame();
  }

  /** Coalesce by key, but start as soon as the picker is available instead of waiting for a frame. */
  queueImmediateContinuous(key: string, job: PickJob): void {
    if (this.#disposed) return;
    if (this.#continuous.has(key)) this.#coalescedDragSamples++;
    this.#continuous.set(key, this.#schedule(job, "drag"));
    this.#immediateContinuous.add(key);
    this.#pump();
  }

  cancelPending(): void {
    this.#discrete.length = 0;
    this.#continuous.clear();
    this.#immediateContinuous.clear();
    this.#continuousReady = false;
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

  getDiagnostics(): InteractionDiagnostics {
    let queuedHover = 0;
    let queuedDrag = 0;
    for (const job of this.#continuous.values()) {
      if (job.kind === "hover") queuedHover++;
      else if (job.kind === "drag") queuedDrag++;
    }
    const settledPicks = this.#completedPicks + this.#failedPicks;
    return Object.freeze({
      queuedDiscrete: this.#discrete.length,
      queuedHover,
      queuedDrag,
      inFlightKind: this.#inFlightKind,
      completedPicks: this.#completedPicks,
      failedPicks: this.#failedPicks,
      coalescedHoverSamples: this.#coalescedHoverSamples,
      coalescedDragSamples: this.#coalescedDragSamples,
      lastSchedulerWaitMs: this.#lastSchedulerWaitMs,
      lastPickDurationMs: this.#lastPickDurationMs,
      averagePickDurationMs: settledPicks > 0 ? this.#totalPickDurationMs / settledPicks : null,
      maximumPickDurationMs: this.#maximumPickDurationMs
    });
  }

  #scheduleContinuousFrame(): void {
    if (this.#frameHandle !== undefined || this.#continuousReady) return;
    this.#frameHandle = this.#frames.request(() => {
      this.#frameHandle = undefined;
      this.#continuousReady = true;
      this.#pump();
    });
  }

  #pump(): void {
    if (this.#busy || this.#disposed) return;
    let job = this.#discrete.shift();
    if (!job && this.#immediateContinuous.size > 0) {
      const key = this.#immediateContinuous.values().next().value as string | undefined;
      if (key !== undefined) {
        this.#immediateContinuous.delete(key);
        job = this.#continuous.get(key);
        this.#continuous.delete(key);
      }
    }
    if (!job && this.#continuousReady) {
      const next = this.#continuous.entries().next().value as [string, ScheduledPickJob] | undefined;
      if (next) {
        this.#continuous.delete(next[0]);
        this.#immediateContinuous.delete(next[0]);
        job = next[1];
      }
      this.#continuousReady = false;
    }
    if (!job) return;

    this.#busy = true;
    this.#inFlightKind = job.kind;
    const startedAt = this.#clock.now();
    this.#lastSchedulerWaitMs = Math.max(0, startedAt - job.queuedAt);
    void this.#driver
      .pick(job.x, job.y, job.filter, job.options, job.detailed)
      .then(
        (result) => {
          this.#recordPickDuration(startedAt);
          this.#completedPicks++;
          job.resolve(result);
        },
        (error) => {
          this.#recordPickDuration(startedAt);
          this.#failedPicks++;
          job.reject(error);
        }
      )
      .finally(() => {
        this.#busy = false;
        this.#inFlightKind = null;
        if (this.#disposed) {
          this.#disposeDriver();
          return;
        }
        if (this.#continuous.size > this.#immediateContinuous.size && !this.#continuousReady) {
          this.#scheduleContinuousFrame();
        }
        this.#pump();
      });
  }

  #disposeDriver(): void {
    if (this.#driverDisposed) return;
    this.#driverDisposed = true;
    this.#driver.dispose();
  }

  #schedule(job: PickJob, kind: InteractionPickKind): ScheduledPickJob {
    return { ...job, kind, queuedAt: this.#clock.now() };
  }

  #recordPickDuration(startedAt: number): void {
    const duration = Math.max(0, this.#clock.now() - startedAt);
    this.#lastPickDurationMs = duration;
    this.#maximumPickDurationMs = Math.max(this.#maximumPickDurationMs ?? 0, duration);
    this.#totalPickDurationMs += duration;
  }
}

export function createBabylonPickDriver(scene: SceneContext): PickDriver {
  const basicPicker: GpuPicker = createGpuPicker(scene);
  let detailedPicker: GpuPicker | undefined;
  return {
    async pick(x, y, filter, options, detailed) {
      let picker = basicPicker;
      if (detailed) {
        if (!detailedPicker) {
          detailedPicker = createGpuPicker(scene);
          enableDetailedPicking(detailedPicker);
        }
        picker = detailedPicker;
      }
      const pickOptions: PickOptions = { filter, ...options };
      const result = await pickAsync(picker, x, y, pickOptions);
      return {
        pickedMesh: result.hit ? (result.pickedMesh as Mesh | null) : null,
        pickedPoint: result.pickedPoint,
        distance: result.hit ? result.distance : null,
        thinInstanceIndex: result.hit ? result.thinInstanceIndex : -1,
        detailedRequested: detailed,
        details: toInteractionPickDetails(result, detailed)
      };
    },
    dispose() {
      disposePicker(basicPicker);
      if (detailedPicker) disposePicker(detailedPicker);
    }
  };
}

export function toInteractionPickDetails(
  result: PickingInfo,
  detailedPicking: boolean
): InteractionPickDetails | null {
  if (!detailedPicking || !result.hit || result.faceId < 0) return null;
  return {
    faceId: result.faceId,
    vertexIndices: null,
    barycentric: [result.bu, result.bv, 1 - result.bu - result.bv],
    bu: result.bu,
    bv: result.bv,
    subMeshId: result.subMeshId,
    thinInstanceIndex: result.thinInstanceIndex,
    pickedNormal: result.pickedNormal,
    pickedNormalWorld: result.pickedNormalWorld,
    pickedFaceNormal: result.pickedFaceNormal,
    pickedFaceNormalWorld: result.pickedFaceNormalWorld,
    pickedUV: getPickedUV(result)
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

export function createBrowserClockDriver(): ClockDriver {
  return {
    now() {
      return typeof performance === "undefined" ? Date.now() : performance.now();
    }
  };
}
