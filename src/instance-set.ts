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
import { assertValidCapacity, InstancerError } from "./errors.js";
import { InstanceSlotStore } from "./slot-store.js";
import {
  composeMat4,
  copyMat4,
  getMat4Position,
  translateMat4,
  withMat4Position,
  withMat4Scale,
  writeZeroScale
} from "./transforms.js";
import {
  type BaseInstanceSet,
  type InstanceCreateInput,
  type InstanceEntry,
  type InstanceBatchWriter,
  type InstanceColorInput,
  type InstanceId,
  type InstanceMatrixUpdate,
  type InstanceMetadataPredicate,
  type InstanceMetadataUpdater,
  type InstanceSetOptions,
  type InstanceSlotEntry,
  type InstanceTransformInput,
  type InstanceTransformUpdate,
  type RawInstanceWriter,
  type Vec3Like
} from "./types.js";

/**
 * Stable-ID manager for thin instances of one Babylon Lite mesh.
 *
 * `InstanceSet` owns the thin instance matrix buffer and optional color buffer. It keeps a stable
 * `InstanceId` for each app object while allowing the underlying slot order to change for removal,
 * visibility packing, or growth.
 */
export interface InstanceSet<TMetadata = unknown> extends BaseInstanceSet<TMetadata> {
  /** Backing Babylon Lite mesh. */
  readonly mesh: Mesh;
}

/** `InstanceSet` with per-instance color support. */
export interface ColoredInstanceSet<TMetadata = unknown> extends InstanceSet<TMetadata> {
  /** Set RGBA color for an ID. Allocates a color buffer lazily if needed. */
  setColor(id: InstanceId, color: InstanceColorInput): void;
  /** Read RGBA color for an ID. Returns white when no color buffer exists. */
  getColor(id: InstanceId, out?: Float32Array): Float32Array;
}

/** Create a stable-ID thin instance manager for one mesh. */
export function createInstanceSet<TMetadata = unknown>(
  mesh: Mesh,
  options: InstanceSetOptions = {}
): ColoredInstanceSet<TMetadata> {
  return new LiteInstanceSet<TMetadata>(mesh, options);
}

class LiteInstanceSet<TMetadata> implements ColoredInstanceSet<TMetadata> {
  readonly mesh: Mesh;

  #capacity: number;
  #slots = new InstanceSlotStore<TMetadata>("instance");
  #matrices: Float32Array;
  #colors: Float32Array | undefined;
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
    return this.#slots.count;
  }

  get capacity(): number {
    return this.#capacity;
  }

  get visibleCount(): number {
    if (this.#visibleStrategy === "scale-zero") {
      return this.#slots.count - this.#hiddenMatrices.size;
    }
    return this.#slots.visibleCount;
  }

  create(transform?: InstanceTransformInput, metadata?: TMetadata): InstanceId {
    this.#ensureCapacity(this.#slots.count + 1);
    const matrix = composeMat4(transform);
    const { id, slot } = this.#slots.create(metadata);
    this.#writeMatrixAt(slot, matrix);

    this.setVisible(id, true);
    this.#syncDrawCount();
    return id;
  }

  createMany(items: Iterable<InstanceCreateInput<TMetadata>>): InstanceId[] {
    const inputs = Array.from(items);
    this.reserve(this.#slots.count + inputs.length);
    return inputs.map((item) => this.create(item.transform, item.metadata));
  }

  remove(id: InstanceId): boolean {
    const removed =
      this.#visibleStrategy === "active-count"
        ? this.#slots.remove(id, (a, b) => this.#swapSlotBuffers(a, b))
        : this.#removeScaleZero(id);
    if (!removed) {
      return false;
    }
    this.#hiddenMatrices.delete(id);
    this.#syncDrawCount();
    return true;
  }

  removeMany(ids: Iterable<InstanceId>): number {
    let removed = 0;
    for (const id of ids) {
      if (this.remove(id)) {
        removed++;
      }
    }
    return removed;
  }

  clear(): void {
    this.#slots.clear();
    this.#hiddenMatrices.clear();
    this.#syncDrawCount();
  }

  has(id: InstanceId): boolean {
    return this.#slots.has(id);
  }

  getSlot(id: InstanceId): number | undefined {
    return this.#slots.getSlot(id);
  }

  getIdForSlot(slot: number): InstanceId | undefined {
    return this.#slots.getIdForSlot(slot);
  }

  *ids(): IterableIterator<InstanceId> {
    yield* this.#slots.ids();
  }

  *visibleIds(): IterableIterator<InstanceId> {
    yield* this.#slots.visibleIds((id) => this.getVisible(id));
  }

  *slots(): IterableIterator<InstanceSlotEntry> {
    yield* this.#slots.slots();
  }

  *entries(): IterableIterator<InstanceEntry<TMetadata>> {
    yield* this.#slots.entries();
  }

  forEach(callback: (id: InstanceId, slot: number) => void): void {
    this.#slots.forEach(callback);
  }

  setMatrix(id: InstanceId, matrix: Mat4): void {
    const slot = this.#slots.requireSlot(id);
    if (this.#visibleStrategy === "scale-zero" && !this.getVisible(id)) {
      this.#hiddenMatrices.set(id, copyMat4(matrix));
      return;
    }
    this.#writeMatrixAt(slot, matrix);
    this.#markMatrixDirty(slot);
  }

  trySetMatrix(id: InstanceId, matrix: Mat4): boolean {
    if (!this.has(id)) {
      return false;
    }
    this.setMatrix(id, matrix);
    return true;
  }

  getMatrix(id: InstanceId, out: Mat4 = new Float32Array(16) as Mat4): Mat4 {
    const slot = this.#slots.requireSlot(id);
    const hidden = this.#hiddenMatrices.get(id);
    if (hidden) {
      (out as Float32Array).set(hidden);
      return out;
    }
    (out as Float32Array).set(this.#matrices.subarray(slot * 16, slot * 16 + 16));
    return out;
  }

  getMatrixOrUndefined(id: InstanceId, out?: Mat4): Mat4 | undefined {
    if (!this.has(id)) {
      return undefined;
    }
    return this.getMatrix(id, out);
  }

  setTransform(id: InstanceId, transform: InstanceTransformInput): void {
    this.setMatrix(id, composeMat4(transform));
  }

  trySetTransform(id: InstanceId, transform: InstanceTransformInput): boolean {
    if (!this.has(id)) {
      return false;
    }
    this.setTransform(id, transform);
    return true;
  }

  getPosition(id: InstanceId, out?: Float32Array): Float32Array {
    return getMat4Position(this.getMatrix(id), out);
  }

  getPositionOrUndefined(id: InstanceId, out?: Float32Array): Float32Array | undefined {
    const matrix = this.getMatrixOrUndefined(id);
    return matrix ? getMat4Position(matrix, out) : undefined;
  }

  setPosition(id: InstanceId, position: Vec3Like): void {
    this.setMatrix(id, withMat4Position(this.getMatrix(id), position));
  }

  trySetPosition(id: InstanceId, position: Vec3Like): boolean {
    if (!this.has(id)) {
      return false;
    }
    this.setPosition(id, position);
    return true;
  }

  translate(id: InstanceId, delta: Vec3Like): void {
    this.setMatrix(id, translateMat4(this.getMatrix(id), delta));
  }

  tryTranslate(id: InstanceId, delta: Vec3Like): boolean {
    if (!this.has(id)) {
      return false;
    }
    this.translate(id, delta);
    return true;
  }

  setScale(id: InstanceId, scale: Vec3Like | number): void {
    this.setMatrix(id, withMat4Scale(this.getMatrix(id), scale));
  }

  trySetScale(id: InstanceId, scale: Vec3Like | number): boolean {
    if (!this.has(id)) {
      return false;
    }
    this.setScale(id, scale);
    return true;
  }

  setMatrices(items: Iterable<InstanceMatrixUpdate>): void {
    this.batch((writer) => {
      for (const item of items) {
        writer.setMatrix(item.id, item.matrix);
      }
    });
  }

  setTransforms(items: Iterable<InstanceTransformUpdate>): void {
    this.batch((writer) => {
      for (const item of items) {
        writer.setTransform(item.id, item.transform);
      }
    });
  }

  getVisible(id: InstanceId): boolean {
    if (this.#visibleStrategy === "active-count") {
      return this.#slots.getActiveCountVisible(id);
    }
    return !this.#hiddenMatrices.has(id);
  }

  getVisibleOrUndefined(id: InstanceId): boolean | undefined {
    if (!this.has(id)) {
      return undefined;
    }
    return this.getVisible(id);
  }

  setVisible(id: InstanceId, visible: boolean): void {
    const slot = this.#slots.requireSlot(id);

    if (this.#visibleStrategy === "active-count") {
      if (this.#slots.setActiveCountVisible(id, visible, (a, b) => this.#swapSlotBuffers(a, b))) {
        this.#syncDrawCount();
      }
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

  trySetVisible(id: InstanceId, visible: boolean): boolean {
    if (!this.has(id)) {
      return false;
    }
    this.setVisible(id, visible);
    return true;
  }

  setVisibleMany(ids: Iterable<InstanceId>, visible: boolean): void {
    this.batch((writer) => {
      for (const id of ids) {
        writer.setVisible(id, visible);
      }
    });
  }

  getMetadata(id: InstanceId): TMetadata | undefined {
    return this.#slots.getMetadata(id);
  }

  setMetadata(id: InstanceId, metadata: TMetadata): void {
    this.#slots.setMetadata(id, metadata);
  }

  trySetMetadata(id: InstanceId, metadata: TMetadata): boolean {
    return this.#slots.trySetMetadata(id, metadata);
  }

  findByMetadata(predicate: InstanceMetadataPredicate<TMetadata>): InstanceId | undefined {
    return this.#slots.findByMetadata(predicate);
  }

  filterByMetadata(predicate: InstanceMetadataPredicate<TMetadata>): InstanceId[] {
    return this.#slots.filterByMetadata(predicate);
  }

  updateMetadata(id: InstanceId, updater: InstanceMetadataUpdater<TMetadata>): TMetadata | undefined {
    return this.#slots.updateMetadata(id, updater);
  }

  tryUpdateMetadata(id: InstanceId, updater: InstanceMetadataUpdater<TMetadata>): TMetadata | undefined {
    return this.#slots.tryUpdateMetadata(id, updater);
  }

  deleteMetadata(id: InstanceId): boolean {
    return this.#slots.deleteMetadata(id);
  }

  setColor(id: InstanceId, color: InstanceColorInput): void {
    if (!this.#colors) {
      this.#colors = new Float32Array(this.#capacity * 4);
      setThinInstanceColors(this.mesh, this.#colors);
      this.#requestBundleInvalidation();
    }
    const slot = this.#slots.requireSlot(id);
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
    const slot = this.#slots.requireSlot(id);
    out.set(this.#colors.subarray(slot * 4, slot * 4 + 4));
    return out;
  }

  batch(callback: (writer: InstanceBatchWriter<TMetadata>) => void): void {
    this.#batchDepth++;
    try {
      callback({
        setMatrix: (id, matrix) => this.setMatrix(id, matrix),
        setTransform: (id, transform) => this.setTransform(id, transform),
        setPosition: (id, position) => this.setPosition(id, position),
        translate: (id, delta) => this.translate(id, delta),
        setScale: (id, scale) => this.setScale(id, scale),
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
    nextMatrices.set(this.#matrices.subarray(0, this.#slots.count * 16));
    this.#matrices = nextMatrices;
    this.#capacity = capacity;
    setThinInstances(this.mesh, this.#matrices, this.#capacity);
    this.#requestBundleInvalidation();

    if (this.#colors) {
      const nextColors = new Float32Array(capacity * 4);
      nextColors.set(this.#colors.subarray(0, this.#slots.count * 4));
      this.#colors = nextColors;
      setThinInstanceColors(this.mesh, this.#colors);
      this.#requestBundleInvalidation();
    }

    this.#syncDrawCount();
  }

  #removeScaleZero(id: InstanceId): boolean {
    return this.#slots.remove(id, (a, b) => this.#swapSlotBuffers(a, b));
  }

  #swapSlotBuffers(a: number, b: number): void {
    this.#swapMatrix(a, b);
    if (this.#colors) {
      this.#swapColor(a, b);
    }
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
    if (slot < this.#slots.visibleCount || this.#visibleStrategy === "scale-zero") {
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
    const drawCount = this.#visibleStrategy === "active-count" ? this.#slots.visibleCount : this.#slots.count;
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
