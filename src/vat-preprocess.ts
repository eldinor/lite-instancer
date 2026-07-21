import {
  computeLiteVatAssetIntegrity,
  validateLiteVatAsset,
  type LiteVatAsset,
  type VatAssetAnimatedBounds,
  type VatAssetClip,
  type VatAssetSourceMetadata
} from "./vat-asset.js";
import type { VatSocketAsset } from "./vat-socket-asset.js";

export interface VatBakeLimits {
  readonly maxModelBytes: number;
  readonly maxBones: number;
  readonly maxFramesPerClip: number;
  readonly maxTotalFrames: number;
  readonly maxAtlasBytes: number;
  readonly maxAnimations: number;
  readonly timeoutMs: number;
}

export const DEFAULT_VAT_BAKE_LIMITS: VatBakeLimits = Object.freeze({
  maxModelBytes: 256 * 1024 * 1024,
  maxBones: 512,
  maxFramesPerClip: 36_000,
  maxTotalFrames: 100_000,
  maxAtlasBytes: 1024 * 1024 * 1024,
  maxAnimations: 512,
  timeoutMs: 120_000
});

/** Neutral sampled-matrix input produced by a loader on the main thread or in a headless tool. */
export interface LiteVatSampledMatrices {
  readonly boneCount: number;
  readonly clips: Readonly<Record<string, VatAssetClip>>;
  readonly frameData: Float32Array;
  readonly sourceBytes?: number;
  readonly sockets?: VatSocketAsset;
  readonly bounds?: VatAssetAnimatedBounds;
  readonly source?: VatAssetSourceMetadata;
}

export function packLiteVatAsset(
  input: LiteVatSampledMatrices,
  limits: VatBakeLimits = DEFAULT_VAT_BAKE_LIMITS
): LiteVatAsset {
  validateLimits(limits);
  if (input.sourceBytes !== undefined && input.sourceBytes > limits.maxModelBytes) {
    throw limitError("model bytes", input.sourceBytes, limits.maxModelBytes);
  }
  if (input.boneCount > limits.maxBones) throw limitError("bones", input.boneCount, limits.maxBones);
  const entries = Object.entries(input.clips);
  if (entries.length > limits.maxAnimations) throw limitError("animations", entries.length, limits.maxAnimations);
  let frameCount = 0;
  for (const [name, clip] of entries) {
    if (clip.frameCount > limits.maxFramesPerClip) {
      throw limitError(`frames in clip '${name}'`, clip.frameCount, limits.maxFramesPerClip);
    }
    frameCount = Math.max(frameCount, clip.fromRow + clip.frameCount);
  }
  if (frameCount > limits.maxTotalFrames) throw limitError("total frames", frameCount, limits.maxTotalFrames);
  if (input.frameData.byteLength > limits.maxAtlasBytes) {
    throw limitError("atlas bytes", input.frameData.byteLength, limits.maxAtlasBytes);
  }
  const asset: LiteVatAsset = {
    version: 1,
    encoding: "lite-matrix-rgba32float",
    basis: "gltf-rh-model-world",
    boneCount: input.boneCount,
    frameCount,
    texture: { width: input.boneCount * 4, height: frameCount, format: "rgba32float" },
    clips: input.clips,
    frameData: input.frameData,
    integrity: computeLiteVatAssetIntegrity(input.frameData),
    ...(input.sockets ? { sockets: input.sockets } : {}),
    ...(input.bounds ? { bounds: input.bounds } : {}),
    ...(input.source ? { source: input.source } : {})
  };
  validateLiteVatAsset(asset);
  return asset;
}

export interface VatBakeProgress {
  readonly completed: number;
  readonly total: number;
  readonly clip?: string;
  readonly frame?: number;
}

export interface VatBakeRequestOptions {
  readonly signal?: AbortSignal;
  readonly timeoutMs?: number;
  readonly onProgress?: (progress: VatBakeProgress) => void;
  /** Transfer and detach `frameData.buffer`. Defaults to true. */
  readonly transferInput?: boolean;
}

export interface VatBakeWorkerPoolOptions {
  readonly workerFactory: () => Worker;
  readonly concurrency?: number;
  readonly limits?: VatBakeLimits;
}

export interface VatBakeWorkerPool {
  bake(input: LiteVatSampledMatrices, options?: VatBakeRequestOptions): Promise<LiteVatAsset>;
  dispose(): void;
}

interface WorkerSlot {
  worker: Worker;
  job: PendingJob | undefined;
}

interface PendingJob {
  id: number;
  input: LiteVatSampledMatrices;
  options: VatBakeRequestOptions;
  resolve: (asset: LiteVatAsset) => void;
  reject: (error: Error) => void;
  timer?: ReturnType<typeof setTimeout>;
  abort?: () => void;
}

type WorkerResponse =
  | { type: "progress"; id: number; progress: VatBakeProgress }
  | { type: "result"; id: number; asset: LiteVatAsset }
  | { type: "error"; id: number; message: string };

export function createVatBakeWorkerPool(options: VatBakeWorkerPoolOptions): VatBakeWorkerPool {
  const concurrency = options.concurrency ?? 1;
  if (!Number.isInteger(concurrency) || concurrency <= 0) throw new Error("VAT worker concurrency must be positive.");
  const limits = options.limits ?? DEFAULT_VAT_BAKE_LIMITS;
  validateLimits(limits);
  const slots: WorkerSlot[] = [];
  const queue: PendingJob[] = [];
  let nextId = 1;
  let disposed = false;

  const createSlot = (): WorkerSlot => {
    const slot: WorkerSlot = { worker: options.workerFactory(), job: undefined };
    slot.worker.addEventListener("message", (event: MessageEvent<WorkerResponse>) => handleMessage(slot, event.data));
    slot.worker.addEventListener("error", () => failSlot(slot, new Error("VAT worker failed.")));
    slot.worker.addEventListener("messageerror", () => failSlot(slot, new Error("VAT worker returned an unreadable message.")));
    return slot;
  };

  const replaceWorker = (slot: WorkerSlot): void => {
    slot.worker.terminate();
    const index = slots.indexOf(slot);
    if (index >= 0 && !disposed) slots[index] = createSlot();
  };

  const finish = (slot: WorkerSlot): PendingJob | undefined => {
    const job = slot.job;
    if (!job) return undefined;
    if (job.timer) clearTimeout(job.timer);
    if (job.abort && job.options.signal) job.options.signal.removeEventListener("abort", job.abort);
    slot.job = undefined;
    queueMicrotask(pump);
    return job;
  };

  const failSlot = (slot: WorkerSlot, error: Error): void => {
    const job = finish(slot);
    if (job) job.reject(error);
    replaceWorker(slot);
  };

  const handleMessage = (slot: WorkerSlot, response: WorkerResponse): void => {
    const job = slot.job;
    if (!job || response.id !== job.id) return;
    if (response.type === "progress") {
      job.options.onProgress?.(response.progress);
      return;
    }
    const finished = finish(slot);
    if (!finished) return;
    if (response.type === "error") {
      finished.reject(new Error(response.message));
    } else {
      try {
        validateLiteVatAsset(response.asset);
        finished.resolve(response.asset);
      } catch (error) {
        finished.reject(asError(error));
      }
    }
  };

  const start = (slot: WorkerSlot, job: PendingJob): void => {
    slot.job = job;
    const timeout = job.options.timeoutMs ?? limits.timeoutMs;
    job.timer = setTimeout(() => failSlot(slot, new Error(`VAT worker timed out after ${timeout}ms.`)), timeout);
    if (job.options.signal) {
      job.abort = () => failSlot(slot, new DOMException("VAT bake aborted.", "AbortError"));
      job.options.signal.addEventListener("abort", job.abort, { once: true });
    }
    const transfer = job.options.transferInput !== false ? [job.input.frameData.buffer] : [];
    slot.worker.postMessage({ type: "bake", id: job.id, input: job.input, limits }, transfer);
  };

  const pump = (): void => {
    if (disposed) return;
    for (const slot of slots) {
      if (slot.job) continue;
      const job = queue.shift();
      if (!job) return;
      if (job.options.signal?.aborted) {
        job.reject(new DOMException("VAT bake aborted.", "AbortError"));
        continue;
      }
      start(slot, job);
    }
  };

  for (let index = 0; index < concurrency; index++) slots.push(createSlot());

  return {
    bake(input, requestOptions = {}) {
      if (disposed) return Promise.reject(new Error("VAT worker pool is disposed."));
      return new Promise<LiteVatAsset>((resolve, reject) => {
        queue.push({ id: nextId++, input, options: requestOptions, resolve, reject });
        pump();
      });
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      for (const job of queue.splice(0)) job.reject(new Error("VAT worker pool was disposed."));
      for (const slot of slots) {
        const job = finish(slot);
        if (job) job.reject(new Error("VAT worker pool was disposed."));
        slot.worker.terminate();
      }
      slots.length = 0;
    }
  };
}

/** Install the matching protocol in a dedicated worker entry module. */
export function installVatBakeWorker(
  scope: { onmessage: ((event: MessageEvent) => void) | null; postMessage(message: unknown, transfer?: Transferable[]): void }
): void {
  scope.onmessage = (event: MessageEvent<{ type: "bake"; id: number; input: LiteVatSampledMatrices; limits: VatBakeLimits }>) => {
    const request = event.data;
    if (request.type !== "bake") return;
    try {
      const clips = Object.keys(request.input.clips);
      const total = Math.max(1, clips.length);
      scope.postMessage({ type: "progress", id: request.id, progress: { completed: 0, total } });
      const asset = packLiteVatAsset(request.input, request.limits);
      for (let index = 0; index < clips.length; index++) {
        scope.postMessage({
          type: "progress",
          id: request.id,
          progress: { completed: index + 1, total, clip: clips[index] }
        });
      }
      scope.postMessage({ type: "result", id: request.id, asset }, [asset.frameData.buffer]);
    } catch (error) {
      scope.postMessage({ type: "error", id: request.id, message: asError(error).message });
    }
  };
}

function validateLimits(limits: VatBakeLimits): void {
  for (const [name, value] of Object.entries(limits)) {
    if (!Number.isFinite(value) || value <= 0) throw new Error(`VAT bake limit '${name}' must be positive and finite.`);
  }
}

function limitError(label: string, requested: number, limit: number): Error {
  return new Error(`VAT bake ${label} limit exceeded: requested ${requested}, maximum ${limit}.`);
}

function asError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}
