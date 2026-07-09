import {
  enableThinInstanceGpuCulling,
  flushThinInstances,
  invalidateRenderBundles,
  setThinInstanceColor,
  setThinInstanceColors,
  setThinInstanceCount,
  setThinInstanceMatrix,
  setThinInstances,
  type EngineContext,
  type Mat4,
  type Mesh
} from "@babylonjs/lite";
import { assertKnownId, assertValidCapacity, InstancerError } from "./errors.js";
import { composeMat4, copyMat4, writeZeroScale } from "./transforms.js";
import {
  type InstanceBatchWriter,
  type InstanceColorInput,
  type InstanceId,
  type InstanceSetOptions,
  type InstanceTransformInput,
  type RawInstanceWriter,
  toInstanceId
} from "./types.js";

export interface InstanceSet<TMetadata = unknown> {
  readonly count: number;
  readonly capacity: number;
  readonly visibleCount: number;
  readonly mesh: Mesh;

  create(transform?: InstanceTransformInput, metadata?: TMetadata): InstanceId;
  remove(id: InstanceId): boolean;
  clear(): void;

  has(id: InstanceId): boolean;
  getSlot(id: InstanceId): number | undefined;
  getIdForSlot(slot: number): InstanceId | undefined;

  setMatrix(id: InstanceId, matrix: Mat4): void;
  getMatrix(id: InstanceId, out?: Mat4): Mat4;
  setTransform(id: InstanceId, transform: InstanceTransformInput): void;
  getVisible(id: InstanceId): boolean;
  setVisible(id: InstanceId, visible: boolean): void;

  getMetadata(id: InstanceId): TMetadata | undefined;
  setMetadata(id: InstanceId, metadata: TMetadata): void;
  deleteMetadata(id: InstanceId): boolean;

  batch(callback: (writer: InstanceBatchWriter<TMetadata>) => void): void;
  editRaw(callback: (raw: RawInstanceWriter) => void): void;

  reserve(capacity: number): void;
  dispose(): void;
}

export interface ColoredInstanceSet<TMetadata = unknown> extends InstanceSet<TMetadata> {
  setColor(id: InstanceId, color: InstanceColorInput): void;
  getColor(id: InstanceId, out?: Float32Array): Float32Array;
}

export function createInstanceSet<TMetadata = unknown>(
  mesh: Mesh,
  options: InstanceSetOptions = {}
): ColoredInstanceSet<TMetadata> {
  return new LiteInstanceSet<TMetadata>(mesh, options);
}

class LiteInstanceSet<TMetadata> implements ColoredInstanceSet<TMetadata> {
  readonly mesh: Mesh;

  #capacity: number;
  #count = 0;
  #visibleCount = 0;
  #nextId = 1;
  #matrices: Float32Array;
  #colors: Float32Array | undefined;
  #idToSlot = new Map<InstanceId, number>();
  #slotToId: InstanceId[] = [];
  #metadata = new Map<InstanceId, TMetadata>();
  #hiddenMatrices = new Map<InstanceId, Mat4>();
  #visibleStrategy: "active-count" | "scale-zero";
  #grow: "none" | "double" | "exact";
  #engine: EngineContext | undefined;
  #batchDepth = 0;
  #needsBundleInvalidation = false;

  constructor(mesh: Mesh, options: InstanceSetOptions) {
    this.mesh = mesh;
    this.#capacity = options.capacity ?? 128;
    assertValidCapacity(this.#capacity);
    this.#grow = options.grow ?? "double";
    this.#engine = options.engine;
    this.#visibleStrategy = options.visibleStrategy ?? "active-count";
    this.#matrices = new Float32Array(this.#capacity * 16);
    setThinInstances(this.mesh, this.#matrices, this.#capacity);
    setThinInstanceCount(this.mesh, 0);

    if (options.colors) {
      this.#colors = new Float32Array(this.#capacity * 4);
      setThinInstanceColors(this.mesh, this.#colors);
    }

    if (options.gpuCulling) {
      enableThinInstanceGpuCulling(this.mesh, true);
    }
  }

  get count(): number {
    return this.#count;
  }

  get capacity(): number {
    return this.#capacity;
  }

  get visibleCount(): number {
    if (this.#visibleStrategy === "scale-zero") {
      return this.#count - this.#hiddenMatrices.size;
    }
    return this.#visibleCount;
  }

  create(transform?: InstanceTransformInput, metadata?: TMetadata): InstanceId {
    this.#ensureCapacity(this.#count + 1);
    const id = toInstanceId(this.#nextId++);
    const matrix = composeMat4(transform);
    const slot = this.#count++;

    this.#slotToId[slot] = id;
    this.#idToSlot.set(id, slot);
    this.#writeMatrixAt(slot, matrix);
    if (metadata !== undefined) {
      this.#metadata.set(id, metadata);
    }

    this.setVisible(id, true);
    this.#syncDrawCount();
    return id;
  }

  remove(id: InstanceId): boolean {
    const slot = this.#idToSlot.get(id);
    if (slot === undefined) {
      return false;
    }

    if (this.#visibleStrategy === "active-count" && slot < this.#visibleCount) {
      const lastVisible = this.#visibleCount - 1;
      this.#swapSlots(slot, lastVisible);
      this.#visibleCount--;
      const removedSlot = this.#visibleCount;
      if (removedSlot !== this.#count - 1) {
        this.#swapSlots(removedSlot, this.#count - 1);
      }
    } else if (slot !== this.#count - 1) {
      this.#swapSlots(slot, this.#count - 1);
    }

    this.#count--;
    this.#slotToId.length = this.#count;
    this.#idToSlot.delete(id);
    this.#metadata.delete(id);
    this.#hiddenMatrices.delete(id);
    this.#syncDrawCount();
    return true;
  }

  clear(): void {
    this.#count = 0;
    this.#visibleCount = 0;
    this.#slotToId = [];
    this.#idToSlot.clear();
    this.#metadata.clear();
    this.#hiddenMatrices.clear();
    this.#syncDrawCount();
  }

  has(id: InstanceId): boolean {
    return this.#idToSlot.has(id);
  }

  getSlot(id: InstanceId): number | undefined {
    return this.#idToSlot.get(id);
  }

  getIdForSlot(slot: number): InstanceId | undefined {
    return this.#slotToId[slot];
  }

  setMatrix(id: InstanceId, matrix: Mat4): void {
    const slot = assertKnownId(id, this.#idToSlot.get(id));
    if (this.#visibleStrategy === "scale-zero" && !this.getVisible(id)) {
      this.#hiddenMatrices.set(id, copyMat4(matrix));
      return;
    }
    this.#writeMatrixAt(slot, matrix);
    this.#markMatrixDirty(slot);
  }

  getMatrix(id: InstanceId, out: Mat4 = new Float32Array(16) as Mat4): Mat4 {
    const slot = assertKnownId(id, this.#idToSlot.get(id));
    const hidden = this.#hiddenMatrices.get(id);
    if (hidden) {
      (out as Float32Array).set(hidden);
      return out;
    }
    (out as Float32Array).set(this.#matrices.subarray(slot * 16, slot * 16 + 16));
    return out;
  }

  setTransform(id: InstanceId, transform: InstanceTransformInput): void {
    this.setMatrix(id, composeMat4(transform));
  }

  getVisible(id: InstanceId): boolean {
    const slot = assertKnownId(id, this.#idToSlot.get(id));
    if (this.#visibleStrategy === "active-count") {
      return slot < this.#visibleCount;
    }
    return !this.#hiddenMatrices.has(id);
  }

  setVisible(id: InstanceId, visible: boolean): void {
    const slot = assertKnownId(id, this.#idToSlot.get(id));

    if (this.#visibleStrategy === "active-count") {
      const currentlyVisible = slot < this.#visibleCount;
      if (currentlyVisible === visible) {
        return;
      }
      if (visible) {
        this.#swapSlots(slot, this.#visibleCount);
        this.#visibleCount++;
      } else {
        this.#visibleCount--;
        this.#swapSlots(slot, this.#visibleCount);
      }
      this.#syncDrawCount();
      return;
    }

    if (visible) {
      const original = this.#hiddenMatrices.get(id);
      if (!original) {
        return;
      }
      this.#hiddenMatrices.delete(id);
      this.#writeMatrixAt(slot, original);
      this.#markMatrixDirty(slot);
      return;
    }

    if (!this.#hiddenMatrices.has(id)) {
      const original = this.getMatrix(id);
      this.#hiddenMatrices.set(id, original);
      this.#writeMatrixAt(slot, writeZeroScale(original));
      this.#markMatrixDirty(slot);
    }
  }

  getMetadata(id: InstanceId): TMetadata | undefined {
    return this.#metadata.get(id);
  }

  setMetadata(id: InstanceId, metadata: TMetadata): void {
    assertKnownId(id, this.#idToSlot.get(id));
    this.#metadata.set(id, metadata);
  }

  deleteMetadata(id: InstanceId): boolean {
    return this.#metadata.delete(id);
  }

  setColor(id: InstanceId, color: InstanceColorInput): void {
    if (!this.#colors) {
      this.#colors = new Float32Array(this.#capacity * 4);
      setThinInstanceColors(this.mesh, this.#colors);
      this.#requestBundleInvalidation();
    }
    const slot = assertKnownId(id, this.#idToSlot.get(id));
    this.#writeColorAt(slot, color);
    if (this.#batchDepth === 0) {
      setThinInstanceColor(this.mesh, slot, color[0], color[1], color[2], color[3]);
      this.#requestBundleInvalidation();
    } else {
      this.#needsBundleInvalidation = this.#engine ? true : this.#needsBundleInvalidation;
    }
  }

  getColor(id: InstanceId, out = new Float32Array(4)): Float32Array {
    if (!this.#colors) {
      out.fill(1);
      return out;
    }
    const slot = assertKnownId(id, this.#idToSlot.get(id));
    out.set(this.#colors.subarray(slot * 4, slot * 4 + 4));
    return out;
  }

  batch(callback: (writer: InstanceBatchWriter<TMetadata>) => void): void {
    this.#batchDepth++;
    try {
      callback({
        setMatrix: (id, matrix) => this.setMatrix(id, matrix),
        setTransform: (id, transform) => this.setTransform(id, transform),
        setVisible: (id, visible) => this.setVisible(id, visible),
        setMetadata: (id, metadata) => this.setMetadata(id, metadata),
        setColor: (id, color) => this.setColor(id, color)
      });
    } finally {
      this.#batchDepth--;
      if (this.#batchDepth === 0) {
        flushThinInstances(this.mesh);
        this.#flushBundleInvalidation();
      }
    }
  }

  editRaw(callback: (raw: RawInstanceWriter) => void): void {
    const raw: RawInstanceWriter = {
      matrices: this.#matrices,
      getSlot: (id) => this.getSlot(id),
      writeMatrix: (id, matrix) => this.setMatrix(id, matrix),
      writeColor: (id, color) => this.setColor(id, color),
      markMatrixDirty: (slot) => this.#markMatrixDirty(slot),
      markColorDirty: (slot) => this.#markColorDirty(slot)
    };
    if (this.#colors) {
      Object.defineProperty(raw, "colors", {
        value: this.#colors,
        enumerable: true
      });
    }
    this.#batchDepth++;
    try {
      callback(raw);
    } finally {
      this.#batchDepth--;
      flushThinInstances(this.mesh);
      if (this.#batchDepth === 0) {
        this.#flushBundleInvalidation();
      }
    }
  }

  reserve(capacity: number): void {
    assertValidCapacity(capacity);
    if (capacity <= this.#capacity) {
      return;
    }
    this.#resize(capacity);
  }

  dispose(): void {
    this.clear();
    this.mesh.thinInstances = null;
  }

  #ensureCapacity(required: number): void {
    if (required <= this.#capacity) {
      return;
    }
    if (this.#grow === "none") {
      throw new InstancerError(`InstanceSet capacity exceeded (${this.#capacity})`);
    }
    const next = this.#grow === "double" ? Math.max(required, Math.max(1, this.#capacity * 2)) : required;
    this.#resize(next);
  }

  #resize(capacity: number): void {
    const nextMatrices = new Float32Array(capacity * 16);
    nextMatrices.set(this.#matrices.subarray(0, this.#count * 16));
    this.#matrices = nextMatrices;
    this.#capacity = capacity;
    setThinInstances(this.mesh, this.#matrices, this.#capacity);
    this.#requestBundleInvalidation();

    if (this.#colors) {
      const nextColors = new Float32Array(capacity * 4);
      nextColors.set(this.#colors.subarray(0, this.#count * 4));
      this.#colors = nextColors;
      setThinInstanceColors(this.mesh, this.#colors);
      this.#requestBundleInvalidation();
    }

    this.#syncDrawCount();
  }

  #swapSlots(a: number, b: number): void {
    if (a === b) {
      return;
    }
    const aId = this.#slotToId[a];
    const bId = this.#slotToId[b];
    if (aId === undefined || bId === undefined) {
      throw new InstancerError("Cannot swap empty instance slots");
    }

    this.#swapMatrix(a, b);
    if (this.#colors) {
      this.#swapColor(a, b);
    }
    this.#slotToId[a] = bId;
    this.#slotToId[b] = aId;
    this.#idToSlot.set(aId, b);
    this.#idToSlot.set(bId, a);
  }

  #writeMatrixAt(slot: number, matrix: Mat4): void {
    this.#matrices.set(matrix, slot * 16);
  }

  #writeColorAt(slot: number, color: InstanceColorInput): void {
    if (!this.#colors) {
      return;
    }
    this.#colors[slot * 4] = color[0];
    this.#colors[slot * 4 + 1] = color[1];
    this.#colors[slot * 4 + 2] = color[2];
    this.#colors[slot * 4 + 3] = color[3];
  }

  #swapMatrix(a: number, b: number): void {
    const aStart = a * 16;
    const bStart = b * 16;
    const tmp = this.#matrices.slice(aStart, aStart + 16);
    this.#matrices.copyWithin(aStart, bStart, bStart + 16);
    this.#matrices.set(tmp, bStart);
    this.#markMatrixDirty(a);
    this.#markMatrixDirty(b);
  }

  #swapColor(a: number, b: number): void {
    if (!this.#colors) {
      return;
    }
    const aStart = a * 4;
    const bStart = b * 4;
    const tmp = this.#colors.slice(aStart, aStart + 4);
    this.#colors.copyWithin(aStart, bStart, bStart + 4);
    this.#colors.set(tmp, bStart);
    this.#markColorDirty(a);
    this.#markColorDirty(b);
  }

  #markMatrixDirty(slot: number): void {
    if (slot < this.#visibleCount || this.#visibleStrategy === "scale-zero") {
      setThinInstanceMatrix(this.mesh, slot, this.#matrices.subarray(slot * 16, slot * 16 + 16) as Mat4);
      this.#requestBundleInvalidation();
    }
  }

  #markColorDirty(slot: number): void {
    if (!this.#colors) {
      return;
    }
    const offset = slot * 4;
    setThinInstanceColor(
      this.mesh,
      slot,
      this.#colors[offset] ?? 1,
      this.#colors[offset + 1] ?? 1,
      this.#colors[offset + 2] ?? 1,
      this.#colors[offset + 3] ?? 1
    );
    this.#requestBundleInvalidation();
  }

  #syncDrawCount(): void {
    const drawCount = this.#visibleStrategy === "active-count" ? this.#visibleCount : this.#count;
    setThinInstanceCount(this.mesh, drawCount);
    this.#requestBundleInvalidation();
  }

  #requestBundleInvalidation(): void {
    if (!this.#engine) {
      return;
    }
    if (this.#batchDepth > 0) {
      this.#needsBundleInvalidation = true;
      return;
    }
    invalidateRenderBundles(this.#engine);
  }

  #flushBundleInvalidation(): void {
    if (!this.#engine || !this.#needsBundleInvalidation) {
      return;
    }
    this.#needsBundleInvalidation = false;
    invalidateRenderBundles(this.#engine);
  }
}
