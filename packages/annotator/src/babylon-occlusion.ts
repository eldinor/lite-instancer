import {
  addTask,
  addTaskAfter,
  createGeometryRendererTask,
  GeometryTextureType,
  type Camera,
  type EngineContext,
  type RenderTarget,
  type SceneContext,
  type Task
} from "@babylonjs/lite";
import { AnnotatorError } from "./error.js";
import { advanceOcclusionHysteresis } from "./occlusion-hysteresis.js";
import type {
  AnnotationId,
  AnnotationOcclusionProvider,
  AnnotationOcclusionRequest,
  AnnotationOcclusionState
} from "./types.js";

export interface BabylonDepthOcclusionOptions {
  scene: SceneContext;
  camera: Camera;
  canvas: HTMLCanvasElement;
  /** Neighbor distance in backing-store pixels. @default 1 */
  sampleRadius?: number;
  /** Required occluding samples out of the five-point cross. @default 3 */
  minimumOccludingSamples?: 1 | 2 | 3 | 4 | 5;
  /** Consecutive occluded readbacks required before entering occlusion. @default 2 */
  enterHysteresis?: number;
  /** Consecutive visible readbacks required before leaving occlusion. @default 2 */
  exitHysteresis?: number;
}

export interface BabylonDepthOcclusionStats {
  readonly lastQueryCount: number;
  readonly submittedQueries: number;
  readonly completedReadbacks: number;
  readonly droppedReadbacks: number;
  readonly inFlightReadbacks: number;
  readonly lastReadbackMs: number;
  readonly averageReadbackMs: number;
}

export interface BabylonDepthOcclusionProvider extends AnnotationOcclusionProvider {
  getStats(): Readonly<BabylonDepthOcclusionStats>;
}

interface InternalEngine extends EngineContext {
  _device: GPUDevice;
  _currentEncoder: GPUCommandEncoder;
}

interface InternalRenderTarget extends RenderTarget {
  _colorTexture: GPUTexture | null;
  _colorView: GPUTextureView | null;
  _width: number;
  _height: number;
}

interface InternalTask extends Task {
  _passes: unknown[];
}

interface InternalFrameGraph {
  _tasks: InternalTask[];
}

interface InternalScene extends SceneContext {
  _frameGraph: InternalFrameGraph;
  _built: boolean;
}

interface StoredResult {
  readonly revision: number;
  readonly state: AnnotationOcclusionState;
  readonly generation: number;
  readonly candidate: AnnotationOcclusionState;
  readonly candidateCount: number;
}

interface Readback {
  readonly buffer: GPUBuffer;
  readonly byteLength: number;
  readonly ids: readonly AnnotationId[];
  readonly revisions: readonly number[];
  readonly generation: number;
  readonly startedAt: number;
}

const QUERY_WORDS = 4;
const PARAM_WORDS = 8;
const WORKGROUP_SIZE = 64;

/**
 * Experimental Babylon Lite depth provider.
 *
 * This deliberately isolates the two private fields currently required:
 * `EngineContext._device/_currentEncoder` and RenderTarget's live color view.
 * Create it before `registerScene()` so its frame-graph tasks are recorded.
 */
export function createBabylonDepthOcclusionProvider(
  options: BabylonDepthOcclusionOptions
): BabylonDepthOcclusionProvider {
  if ((options.scene as InternalScene)._built) {
    throw new AnnotatorError(
      "Babylon depth occlusion must be created before registerScene() builds the frame graph"
    );
  }
  const radius = options.sampleRadius ?? 1;
  if (!Number.isInteger(radius) || radius < 0) {
    throw new AnnotatorError("Occlusion sample radius must be a non-negative integer");
  }
  const threshold = options.minimumOccludingSamples ?? 3;
  const enterHysteresis = validateHysteresis(options.enterHysteresis ?? 2, "enter");
  const exitHysteresis = validateHysteresis(options.exitHysteresis ?? 2, "exit");
  const engine = options.scene.surface.engine as InternalEngine;
  if (!engine._device) {
    throw new AnnotatorError("Babylon depth occlusion requires an initialized WebGPU device");
  }

  const geometryTask = createGeometryRendererTask(
    {
      name: "annotator-occlusion-depth",
      camera: options.camera,
      size: options.scene.surface,
      samples: 1,
      textureDescriptions: [
        {
          type: GeometryTextureType.SCREENSPACE_DEPTH,
          format: "r32float"
        }
      ]
    },
    engine,
    options.scene
  );
  const depthTarget = geometryTask.geometryScreenspaceDepthTexture as InternalRenderTarget | null;
  if (!depthTarget) throw new AnnotatorError("Babylon geometry renderer did not create a depth output");

  const state = new BabylonDepthOcclusionState(
    engine,
    options.scene as InternalScene,
    options.canvas,
    depthTarget,
    radius,
    threshold,
    enterHysteresis,
    exitHysteresis
  );
  const computeTask = state.task;
  addTask(options.scene, geometryTask);
  addTaskAfter(options.scene, computeTask, geometryTask);
  state.attachTasks(geometryTask as unknown as InternalTask, computeTask);
  return state;
}

class BabylonDepthOcclusionState implements BabylonDepthOcclusionProvider {
  readonly task: InternalTask;

  readonly #engine: InternalEngine;
  readonly #scene: InternalScene;
  readonly #canvas: HTMLCanvasElement;
  readonly #depthTarget: InternalRenderTarget;
  readonly #radius: number;
  readonly #threshold: number;
  readonly #enterHysteresis: number;
  readonly #exitHysteresis: number;
  readonly #results = new Map<AnnotationId, StoredResult>();
  readonly #freeReadbacks: GPUBuffer[] = [];
  readonly #inFlightReadbacks = new Set<GPUBuffer>();
  readonly #readbackSizes = new WeakMap<GPUBuffer, number>();

  #geometryTask: InternalTask | undefined;
  #computeTask: InternalTask | undefined;
  #requests: readonly AnnotationOcclusionRequest[] = [];
  #generation = 0;
  #lastQueryCount = 0;
  #submittedQueries = 0;
  #completedReadbacks = 0;
  #droppedReadbacks = 0;
  #lastReadbackMs = 0;
  #averageReadbackMs = 0;
  #capacity = 0;
  #queryBuffer: GPUBuffer | null = null;
  #resultBuffer: GPUBuffer | null = null;
  #paramsBuffer: GPUBuffer | null = null;
  #pipeline: GPUComputePipeline | null = null;
  #bindGroup: GPUBindGroup | null = null;
  #boundView: GPUTextureView | null = null;
  #disposed = false;

  constructor(
    engine: InternalEngine,
    scene: InternalScene,
    canvas: HTMLCanvasElement,
    depthTarget: InternalRenderTarget,
    radius: number,
    threshold: number,
    enterHysteresis: number,
    exitHysteresis: number
  ) {
    this.#engine = engine;
    this.#scene = scene;
    this.#canvas = canvas;
    this.#depthTarget = depthTarget;
    this.#radius = radius;
    this.#threshold = threshold;
    this.#enterHysteresis = enterHysteresis;
    this.#exitHysteresis = exitHysteresis;
    this.task = {
      name: "annotator-occlusion-query",
      engine,
      scene,
      _passes: [],
      record: () => {
        this.#ensurePipeline();
        this.#bindGroup = null;
        this.#boundView = null;
      },
      execute: () => this.#execute(),
      dispose: () => this.#disposeGpuResources()
    };
  }

  attachTasks(geometryTask: InternalTask, computeTask: InternalTask): void {
    this.#geometryTask = geometryTask;
    this.#computeTask = computeTask;
  }

  getResult(id: AnnotationId, revision: number): AnnotationOcclusionState {
    const result = this.#results.get(id);
    return result?.revision === revision ? result.state : "unknown";
  }

  getStats(): Readonly<BabylonDepthOcclusionStats> {
    return Object.freeze({
      lastQueryCount: this.#lastQueryCount,
      submittedQueries: this.#submittedQueries,
      completedReadbacks: this.#completedReadbacks,
      droppedReadbacks: this.#droppedReadbacks,
      inFlightReadbacks: this.#inFlightReadbacks.size,
      lastReadbackMs: this.#lastReadbackMs,
      averageReadbackMs: this.#averageReadbackMs
    });
  }

  update(requests: readonly AnnotationOcclusionRequest[]): void {
    if (this.#disposed) throw new AnnotatorError("Occlusion provider has been disposed");
    this.#requests = requests.slice();
    this.#lastQueryCount = requests.length;
    const active = new Set(requests.map((request) => request.id));
    for (const id of this.#results.keys()) {
      if (!active.has(id)) this.#results.delete(id);
    }
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    this.#requests = [];
    this.#results.clear();
    const tasks = this.#scene._frameGraph._tasks;
    for (const owned of [this.#computeTask, this.#geometryTask]) {
      if (!owned) continue;
      const index = tasks.indexOf(owned);
      if (index >= 0) tasks.splice(index, 1);
      owned.dispose();
    }
    this.#computeTask = undefined;
    this.#geometryTask = undefined;
    this.#disposeGpuResources();
    for (const buffer of this.#freeReadbacks) buffer.destroy();
    this.#freeReadbacks.length = 0;
  }

  #execute(): number {
    if (this.#disposed || this.#requests.length === 0) return 0;
    const view = this.#depthTarget._colorView;
    const width = this.#depthTarget._width;
    const height = this.#depthTarget._height;
    if (!view || width <= 0 || height <= 0) return 0;

    this.#ensureCapacity(this.#requests.length);
    this.#ensureBindGroup(view);
    const readback = this.#takeReadback(this.#requests.length * Uint32Array.BYTES_PER_ELEMENT);
    if (!readback || !this.#queryBuffer || !this.#resultBuffer || !this.#paramsBuffer || !this.#bindGroup || !this.#pipeline) {
      if (!readback) this.#droppedReadbacks++;
      return 0;
    }

    const queryData = new ArrayBuffer(this.#requests.length * QUERY_WORDS * Uint32Array.BYTES_PER_ELEMENT);
    const queryU32 = new Uint32Array(queryData);
    const queryF32 = new Float32Array(queryData);
    const rect = this.#canvas.getBoundingClientRect();
    const cssWidth = rect.width || this.#canvas.clientWidth || this.#canvas.width;
    const cssHeight = rect.height || this.#canvas.clientHeight || this.#canvas.height;
    const scaleX = cssWidth > 0 ? width / cssWidth : 1;
    const scaleY = cssHeight > 0 ? height / cssHeight : 1;
    const ids: AnnotationId[] = [];
    const revisions: number[] = [];
    for (let index = 0; index < this.#requests.length; index++) {
      const request = this.#requests[index]!;
      const offset = index * QUERY_WORDS;
      queryU32[offset] = clampInteger(Math.floor(request.screenPosition.x * scaleX), 0, width - 1);
      queryU32[offset + 1] = clampInteger(Math.floor(request.screenPosition.y * scaleY), 0, height - 1);
      queryF32[offset + 2] = request.depth;
      queryF32[offset + 3] = request.bias;
      ids.push(request.id);
      revisions.push(request.revision);
    }
    const params = new Uint32Array(PARAM_WORDS);
    params[0] = this.#requests.length;
    params[1] = width;
    params[2] = height;
    params[3] = this.#radius;
    params[4] = this.#threshold;
    const device = this.#engine._device;
    device.queue.writeBuffer(this.#queryBuffer, 0, queryData);
    device.queue.writeBuffer(this.#paramsBuffer, 0, params);

    const pass = this.#engine._currentEncoder.beginComputePass({ label: "annotator-occlusion-query" });
    pass.setPipeline(this.#pipeline);
    pass.setBindGroup(0, this.#bindGroup);
    pass.dispatchWorkgroups(Math.ceil(this.#requests.length / WORKGROUP_SIZE));
    pass.end();
    const byteLength = this.#requests.length * Uint32Array.BYTES_PER_ELEMENT;
    this.#engine._currentEncoder.copyBufferToBuffer(this.#resultBuffer, 0, readback, 0, byteLength);

    const generation = ++this.#generation;
    this.#submittedQueries += this.#requests.length;
    this.#inFlightReadbacks.add(readback);
    const pending: Readback = {
      buffer: readback,
      byteLength,
      ids,
      revisions,
      generation,
      startedAt: now()
    };
    queueMicrotask(() => void this.#readResults(pending));
    return 0;
  }

  async #readResults(pending: Readback): Promise<void> {
    try {
      await pending.buffer.mapAsync(GPUMapMode.READ, 0, pending.byteLength);
      const values = new Uint32Array(pending.buffer.getMappedRange(0, pending.byteLength));
      if (!this.#disposed) {
        for (let index = 0; index < pending.ids.length; index++) {
          const id = pending.ids[index]!;
          this.#publishResult(
            id,
            pending.revisions[index]!,
            values[index] === 2 ? "occluded" : "visible",
            pending.generation
          );
        }
        const elapsed = now() - pending.startedAt;
        this.#lastReadbackMs = elapsed;
        this.#completedReadbacks++;
        this.#averageReadbackMs +=
          (elapsed - this.#averageReadbackMs) / this.#completedReadbacks;
      }
      pending.buffer.unmap();
      this.#inFlightReadbacks.delete(pending.buffer);
      if (this.#disposed) pending.buffer.destroy();
      else if ((this.#readbackSizes.get(pending.buffer) ?? 0) >= this.#capacity * Uint32Array.BYTES_PER_ELEMENT) {
        this.#freeReadbacks.push(pending.buffer);
      } else {
        pending.buffer.destroy();
      }
    } catch {
      this.#inFlightReadbacks.delete(pending.buffer);
      pending.buffer.destroy();
    }
  }

  #ensurePipeline(): void {
    if (this.#pipeline) return;
    const device = this.#engine._device;
    const module = device.createShaderModule({
      label: "annotator-occlusion-query",
      code: OCCLUSION_SHADER
    });
    this.#pipeline = device.createComputePipeline({
      label: "annotator-occlusion-query",
      layout: "auto",
      compute: { module, entryPoint: "main" }
    });
  }

  #publishResult(
    id: AnnotationId,
    revision: number,
    raw: Exclude<AnnotationOcclusionState, "unknown">,
    generation: number
  ): void {
    const prior = this.#results.get(id);
    if (prior && prior.generation > generation) return;
    if (!prior || prior.revision !== revision) {
      const next = advanceOcclusionHysteresis(
        undefined,
        raw,
        this.#enterHysteresis,
        this.#exitHysteresis
      );
      this.#results.set(id, {
        revision,
        generation,
        ...next
      });
      return;
    }
    const next = advanceOcclusionHysteresis(
      prior,
      raw,
      this.#enterHysteresis,
      this.#exitHysteresis
    );
    this.#results.set(id, {
      revision,
      generation,
      ...next
    });
  }

  #ensureCapacity(count: number): void {
    if (count <= this.#capacity) return;
    this.#capacity = nextPowerOfTwo(count);
    this.#queryBuffer?.destroy();
    this.#resultBuffer?.destroy();
    this.#queryBuffer = this.#engine._device.createBuffer({
      label: "annotator-occlusion-queries",
      size: this.#capacity * QUERY_WORDS * Uint32Array.BYTES_PER_ELEMENT,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST
    });
    this.#resultBuffer = this.#engine._device.createBuffer({
      label: "annotator-occlusion-results",
      size: this.#capacity * Uint32Array.BYTES_PER_ELEMENT,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC
    });
    this.#paramsBuffer ??= this.#engine._device.createBuffer({
      label: "annotator-occlusion-params",
      size: PARAM_WORDS * Uint32Array.BYTES_PER_ELEMENT,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
    });
    for (const buffer of this.#freeReadbacks) buffer.destroy();
    this.#freeReadbacks.length = 0;
    this.#bindGroup = null;
  }

  #ensureBindGroup(view: GPUTextureView): void {
    this.#ensurePipeline();
    if (this.#bindGroup && this.#boundView === view) return;
    if (!this.#pipeline || !this.#queryBuffer || !this.#resultBuffer || !this.#paramsBuffer) return;
    this.#bindGroup = this.#engine._device.createBindGroup({
      label: "annotator-occlusion-query",
      layout: this.#pipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: view },
        { binding: 1, resource: { buffer: this.#queryBuffer } },
        { binding: 2, resource: { buffer: this.#resultBuffer } },
        { binding: 3, resource: { buffer: this.#paramsBuffer } }
      ]
    });
    this.#boundView = view;
  }

  #takeReadback(byteLength: number): GPUBuffer | null {
    while (this.#freeReadbacks.length > 0) {
      const candidate = this.#freeReadbacks.pop()!;
      if ((this.#readbackSizes.get(candidate) ?? 0) >= byteLength) return candidate;
      candidate.destroy();
    }
    if (this.#inFlightReadbacks.size >= 3) return null;
    const size = Math.max(byteLength, this.#capacity * Uint32Array.BYTES_PER_ELEMENT);
    const buffer = this.#engine._device.createBuffer({
      label: "annotator-occlusion-readback",
      size,
      usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ
    });
    this.#readbackSizes.set(buffer, size);
    return buffer;
  }

  #disposeGpuResources(): void {
    this.#queryBuffer?.destroy();
    this.#queryBuffer = null;
    this.#resultBuffer?.destroy();
    this.#resultBuffer = null;
    this.#paramsBuffer?.destroy();
    this.#paramsBuffer = null;
    this.#bindGroup = null;
    this.#boundView = null;
    this.#pipeline = null;
    this.#capacity = 0;
  }
}

function nextPowerOfTwo(value: number): number {
  let result = 1;
  while (result < value) result *= 2;
  return result;
}

function clampInteger(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function validateHysteresis(value: number, label: string): number {
  if (!Number.isInteger(value) || value < 1) {
    throw new AnnotatorError(`Occlusion ${label} hysteresis must be a positive integer`);
  }
  return value;
}

function now(): number {
  return globalThis.performance?.now() ?? Date.now();
}

const OCCLUSION_SHADER = /* wgsl */ `
struct Query {
  pixel: vec2<u32>,
  depth: f32,
  bias: f32,
};

struct Params {
  count: u32,
  width: u32,
  height: u32,
  radius: u32,
  threshold: u32,
  _padding0: u32,
  _padding1: u32,
  _padding2: u32,
};

@group(0) @binding(0) var depthTexture: texture_2d<f32>;
@group(0) @binding(1) var<storage, read> queries: array<Query>;
@group(0) @binding(2) var<storage, read_write> results: array<u32>;
@group(0) @binding(3) var<uniform> params: Params;

fn isOccluding(pixel: vec2<i32>, query: Query) -> u32 {
  let maximum = vec2<i32>(i32(params.width) - 1, i32(params.height) - 1);
  let point = clamp(pixel, vec2<i32>(0), maximum);
  let sceneDepth = textureLoad(depthTexture, point, 0).r;
  return select(0u, 1u, sceneDepth > query.depth + query.bias);
}

@compute @workgroup_size(${WORKGROUP_SIZE})
fn main(@builtin(global_invocation_id) globalId: vec3<u32>) {
  let index = globalId.x;
  if (index >= params.count) {
    return;
  }
  let query = queries[index];
  let center = vec2<i32>(query.pixel);
  let radius = i32(params.radius);
  var hits = isOccluding(center, query);
  hits += isOccluding(center + vec2<i32>(radius, 0), query);
  hits += isOccluding(center + vec2<i32>(-radius, 0), query);
  hits += isOccluding(center + vec2<i32>(0, radius), query);
  hits += isOccluding(center + vec2<i32>(0, -radius), query);
  results[index] = select(1u, 2u, hits >= params.threshold);
}
`;
