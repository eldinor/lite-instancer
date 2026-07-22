import {
  enableThinInstanceDynamicDrawCount,
  enableThinInstanceGpuCulling,
  flushThinInstances,
  invalidateRenderBundles,
  setThinInstanceColor,
  setThinInstanceColors,
  setThinInstanceCount,
  setThinInstanceDrawCount,
  setThinInstanceMatrix,
  setThinInstances,
  type EngineContext,
  type Mat4,
  type Mesh
} from "@babylonjs/lite";
import { assertValidCapacity, InstancerError } from "./errors.js";
import {
  copyMatrix16,
  readMatrixPosition,
  swapMatrix16,
  translateMatrixPosition,
  writeMatrixPosition,
  writeMatrixScale,
  writeZeroMatrixScale
} from "./matrix-buffer.js";
import { InstanceSlotStore } from "./slot-store.js";
import {
  createHostSlotStream,
  disposeSlotStreamHost,
  notifySlotCapacity,
  notifySlotCreated,
  notifySlotsCleared,
  notifySlotsSwapped,
  notifySlotsTruncated,
  registerSlotStreamHost,
  type SlotAlignedFloatStream
} from "./slot-aligned-stream.js";
import { composeMat4 } from "./transforms.js";
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
  /** Backing Babylon Lite mesh. The caller retains ownership of the mesh, geometry, and material. */
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
  #matrixScratch = new Float32Array(16);
  #colors: Float32Array | undefined;
  #colorStream: SlotAlignedFloatStream | undefined;
  #hiddenMatrices = new Map<InstanceId, Mat4>();
  #visibleStrategy: "active-count" | "scale-zero";
  #grow: "none" | "double" | "exact";
  #engine: EngineContext | undefined;
  #dynamicDrawCount: boolean;
  #batchDepth = 0;
  #needsBundleInvalidation = false;
  #syncedDrawCount = 0;
  #needsDrawCountSync = false;
  #postCountDirtySlots = new Set<number>();
  #postCountColorDirtySlots = new Set<number>();
  #disposed = false;

  constructor(mesh: Mesh, options: InstanceSetOptions) {
    this.mesh = mesh;
    this.#capacity = options.capacity ?? 128;
    assertValidCapacity(this.#capacity);
    this.#grow = options.grow ?? "double";
    this.#engine = options.engine;
    this.#dynamicDrawCount = options.dynamicDrawCount ?? true;
    this.#visibleStrategy = options.visibleStrategy ?? "active-count";
    this.#matrices = new Float32Array(this.#capacity * 16);
    registerSlotStreamHost(this, this.#capacity);
    setThinInstances(this.mesh, this.#matrices, this.#capacity);
    setThinInstanceCount(this.mesh, 0);

    if (options.colors) this.#ensureColorStream();

    if (options.gpuCulling) {
      enableThinInstanceGpuCulling(this.mesh, true);
    }
    if (this.#dynamicDrawCount) enableThinInstanceDynamicDrawCount(this.mesh);
  }

  get count(): number {
    this.#assertUsable();
    return this.#slots.count;
  }

  get capacity(): number {
    this.#assertUsable();
    return this.#capacity;
  }

  get visibleCount(): number {
    this.#assertUsable();
    if (this.#visibleStrategy === "scale-zero") {
      return this.#slots.count - this.#hiddenMatrices.size;
    }
    return this.#slots.visibleCount;
  }

  create(transform?: InstanceTransformInput, metadata?: TMetadata): InstanceId {
    this.#assertUsable();
    this.#ensureCapacity(this.#slots.count + 1);
    const matrix = composeMat4(transform);
    const { id, slot } = this.#slots.create(metadata);
    notifySlotCreated(this, slot);
    this.#writeMatrixAt(slot, matrix);

    this.setVisible(id, true);
    if (this.#visibleStrategy === "scale-zero") {
      const colorAlreadyDirty = this.#colorStream?.isDirty(slot) ?? false;
      this.#syncDrawCount();
      this.#markPostCountDirty(slot, colorAlreadyDirty);
    } else {
      this.#syncDrawCount();
    }
    return id;
  }

  createMany(items: Iterable<InstanceCreateInput<TMetadata>>): InstanceId[] {
    this.#assertUsable();
    const inputs = Array.from(items);
    this.reserve(this.#slots.count + inputs.length);
    const ids: InstanceId[] = [];
    this.batch(() => {
      for (const item of inputs) {
        ids.push(this.create(item.transform, item.metadata));
      }
    });
    return ids;
  }

  remove(id: InstanceId): boolean {
    this.#assertUsable();
    const removed =
      this.#visibleStrategy === "active-count"
        ? this.#slots.remove(id, (a, b) => this.#swapSlotBuffers(a, b))
        : this.#removeScaleZero(id);
    if (!removed) {
      return false;
    }
    this.#hiddenMatrices.delete(id);
    notifySlotsTruncated(this, this.#slots.count);
    this.#syncDrawCount();
    return true;
  }

  removeMany(ids: Iterable<InstanceId>): number {
    let removed = 0;
    this.batch(() => {
      for (const id of ids) {
        if (this.remove(id)) {
          removed++;
        }
      }
    });
    return removed;
  }

  clear(): void {
    this.#assertUsable();
    this.#slots.clear();
    this.#hiddenMatrices.clear();
    notifySlotsCleared(this);
    this.#syncDrawCount();
  }

  has(id: InstanceId): boolean {
    this.#assertUsable();
    return this.#slots.has(id);
  }

  getSlot(id: InstanceId): number | undefined {
    this.#assertUsable();
    return this.#slots.getSlot(id);
  }

  getIdForSlot(slot: number): InstanceId | undefined {
    this.#assertUsable();
    return this.#slots.getIdForSlot(slot);
  }

  *ids(): IterableIterator<InstanceId> {
    this.#assertUsable();
    yield* this.#slots.ids();
  }

  *visibleIds(): IterableIterator<InstanceId> {
    this.#assertUsable();
    yield* this.#slots.visibleIds((id) => this.getVisible(id));
  }

  *slots(): IterableIterator<InstanceSlotEntry> {
    this.#assertUsable();
    yield* this.#slots.slots();
  }

  *entries(): IterableIterator<InstanceEntry<TMetadata>> {
    this.#assertUsable();
    yield* this.#slots.entries();
  }

  forEach(callback: (id: InstanceId, slot: number) => void): void {
    this.#assertUsable();
    this.#slots.forEach(callback);
  }

  setMatrix(id: InstanceId, matrix: Mat4): void {
    this.#assertUsable();
    const slot = this.#slots.requireSlot(id);
    const hidden = this.#hiddenMatrices.get(id);
    if (hidden) {
      (hidden as Float32Array).set(matrix);
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

  getMatrix(id: InstanceId, out?: Mat4): Mat4 {
    this.#assertUsable();
    const slot = this.#slots.requireSlot(id);
    const target = out ?? new Float32Array(16) as Mat4;
    const hidden = this.#hiddenMatrices.get(id);
    if (hidden) {
      (target as Float32Array).set(hidden);
      return target;
    }
    (target as Float32Array).set(this.#matrices.subarray(slot * 16, slot * 16 + 16));
    return target;
  }

  getMatrixOrUndefined(id: InstanceId, out?: Mat4): Mat4 | undefined {
    if (!this.has(id)) {
      return undefined;
    }
    return this.getMatrix(id, out);
  }

  setTransform(id: InstanceId, transform: InstanceTransformInput): void {
    this.#assertUsable();
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
    this.#assertUsable();
    const slot = this.#slots.requireSlot(id);
    const hidden = this.#hiddenMatrices.get(id);
    const buffer = hidden ? hidden as Float32Array : this.#matrices;
    return readMatrixPosition(buffer, hidden ? 0 : slot * 16, out);
  }

  getPositionOrUndefined(id: InstanceId, out?: Float32Array): Float32Array | undefined {
    if (!this.has(id)) {
      return undefined;
    }
    return this.getPosition(id, out);
  }

  setPosition(id: InstanceId, position: Vec3Like): void {
    this.#assertUsable();
    const slot = this.#slots.requireSlot(id);
    const hidden = this.#hiddenMatrices.get(id);
    if (hidden) {
      writeMatrixPosition(hidden as Float32Array, 0, position);
      return;
    }
    writeMatrixPosition(this.#matrices, slot * 16, position);
    this.#markMatrixDirty(slot);
  }

  trySetPosition(id: InstanceId, position: Vec3Like): boolean {
    if (!this.has(id)) {
      return false;
    }
    this.setPosition(id, position);
    return true;
  }

  translate(id: InstanceId, delta: Vec3Like): void {
    this.#assertUsable();
    const slot = this.#slots.requireSlot(id);
    const hidden = this.#hiddenMatrices.get(id);
    if (hidden) {
      translateMatrixPosition(hidden as Float32Array, 0, delta);
      return;
    }
    translateMatrixPosition(this.#matrices, slot * 16, delta);
    this.#markMatrixDirty(slot);
  }

  tryTranslate(id: InstanceId, delta: Vec3Like): boolean {
    if (!this.has(id)) {
      return false;
    }
    this.translate(id, delta);
    return true;
  }

  setScale(id: InstanceId, scale: Vec3Like | number): void {
    this.#assertUsable();
    const slot = this.#slots.requireSlot(id);
    const hidden = this.#hiddenMatrices.get(id);
    if (hidden) {
      writeMatrixScale(hidden as Float32Array, 0, scale);
      return;
    }
    writeMatrixScale(this.#matrices, slot * 16, scale);
    this.#markMatrixDirty(slot);
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
    this.#assertUsable();
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
    this.#assertUsable();
    const slot = this.#slots.requireSlot(id);

    if (this.#visibleStrategy === "active-count") {
      const previousSlot = slot;
      if (this.#slots.setActiveCountVisible(id, visible, (a, b) => this.#swapSlotBuffers(a, b))) {
        const currentSlot = this.#slots.requireSlot(id);
        const colorAlreadyDirty = this.#colorStream?.isDirty(currentSlot) ?? false;
        this.#syncDrawCount();
        if (visible && currentSlot === previousSlot) {
          this.#markPostCountDirty(currentSlot, colorAlreadyDirty);
        }
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
      const original = new Float32Array(16) as Mat4;
      copyMatrix16(this.#matrices, slot * 16, original as Float32Array);
      this.#hiddenMatrices.set(id, original);
      writeZeroMatrixScale(this.#matrices, slot * 16);
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
    this.#assertUsable();
    return this.#slots.getMetadata(id);
  }

  setMetadata(id: InstanceId, metadata: TMetadata): void {
    this.#assertUsable();
    this.#slots.setMetadata(id, metadata);
  }

  trySetMetadata(id: InstanceId, metadata: TMetadata): boolean {
    this.#assertUsable();
    return this.#slots.trySetMetadata(id, metadata);
  }

  findByMetadata(predicate: InstanceMetadataPredicate<TMetadata>): InstanceId | undefined {
    this.#assertUsable();
    return this.#slots.findByMetadata(predicate);
  }

  filterByMetadata(predicate: InstanceMetadataPredicate<TMetadata>): InstanceId[] {
    this.#assertUsable();
    return this.#slots.filterByMetadata(predicate);
  }

  updateMetadata(id: InstanceId, updater: InstanceMetadataUpdater<TMetadata>): TMetadata | undefined {
    this.#assertUsable();
    return this.#slots.updateMetadata(id, updater);
  }

  tryUpdateMetadata(id: InstanceId, updater: InstanceMetadataUpdater<TMetadata>): TMetadata | undefined {
    this.#assertUsable();
    return this.#slots.tryUpdateMetadata(id, updater);
  }

  deleteMetadata(id: InstanceId): boolean {
    this.#assertUsable();
    return this.#slots.deleteMetadata(id);
  }

  setColor(id: InstanceId, color: InstanceColorInput): void {
    this.#assertUsable();
    const slot = this.#slots.requireSlot(id);
    const stream = this.#ensureColorStream();
    stream.setSlot(slot, color);
    if (this.#batchDepth === 0) {
      stream.flush(this.#slots.count);
    }
  }

  getColor(id: InstanceId, out?: Float32Array): Float32Array {
    this.#assertUsable();
    const slot = this.#slots.requireSlot(id);
    const target = out ?? new Float32Array(4);
    if (!this.#colors) {
      target.fill(1);
      return target;
    }
    target.set(this.#colors.subarray(slot * 4, slot * 4 + 4));
    return target;
  }

  batch(callback: (writer: InstanceBatchWriter<TMetadata>) => void): void {
    this.#assertUsable();
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
        this.#flushDrawCount();
        this.#flushPostCountDirty();
        this.#colorStream?.flush(this.#slots.count);
        this.#flushBundleInvalidation();
      }
    }
  }

  editRaw(callback: (raw: RawInstanceWriter) => void): void {
    this.#assertUsable();
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
      this.#colorStream?.flush(this.#slots.count);
      flushThinInstances(this.mesh);
      if (this.#batchDepth === 0) {
        this.#flushBundleInvalidation();
      }
    }
  }

  reserve(capacity: number): void {
    this.#assertUsable();
    assertValidCapacity(capacity);
    if (capacity <= this.#capacity) {
      return;
    }
    this.#resize(capacity);
  }

  dispose(): void {
    if (this.#disposed) {
      return;
    }
    this.#slots.clear();
    this.#hiddenMatrices.clear();
    notifySlotsCleared(this);
    disposeSlotStreamHost(this);
    if (this.mesh.thinInstances?.matrices === this.#matrices) {
      this.mesh.thinInstances = null;
    }
    this.#disposed = true;
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
    notifySlotCapacity(this, capacity);
    setThinInstances(this.mesh, this.#matrices, this.#capacity);
    if (this.#dynamicDrawCount) enableThinInstanceDynamicDrawCount(this.mesh);
    this.#requestBundleInvalidation();

    this.#syncedDrawCount = -1;
    this.#syncDrawCount();
  }

  #removeScaleZero(id: InstanceId): boolean {
    return this.#slots.remove(id, (a, b) => this.#swapSlotBuffers(a, b));
  }

  #swapSlotBuffers(a: number, b: number): void {
    this.#swapMatrix(a, b);
    notifySlotsSwapped(this, a, b);
  }

  #writeMatrixAt(slot: number, matrix: Mat4): void {
    this.#matrices.set(matrix, slot * 16);
  }

  #swapMatrix(a: number, b: number): void {
    const aStart = a * 16;
    const bStart = b * 16;
    swapMatrix16(this.#matrices, aStart, bStart, this.#matrixScratch);
    this.#markMatrixDirty(a);
    this.#markMatrixDirty(b);
  }

  #markMatrixDirty(slot: number): void {
    if (slot < this.#slots.visibleCount || this.#visibleStrategy === "scale-zero") {
      copyMatrix16(this.#matrices, slot * 16, this.#matrixScratch);
      setThinInstanceMatrix(this.mesh, slot, this.#matrixScratch as Mat4);
    }
  }

  #markColorDirty(slot: number): void {
    if (!this.#colorStream) return;
    this.#colorStream.markDirty(slot);
    if (this.#batchDepth === 0) this.#colorStream.flush(this.#slots.count);
  }

  #ensureColorStream(): SlotAlignedFloatStream {
    if (this.#colorStream) return this.#colorStream;
    const stream = createHostSlotStream(this, {
      components: 4,
      defaultValue: [1, 1, 1, 1],
      backend: {
        bind: (data) => {
          this.#colors = data;
          setThinInstanceColors(this.mesh, data);
          this.#requestBundleInvalidation();
        },
        upload: (data, count, ranges) => {
          let uploadedSlots = 0;
          for (const range of ranges) {
            const end = Math.min(range.end, count - 1);
            for (let slot = range.start; slot <= end; slot++) {
              const offset = slot * 4;
              setThinInstanceColor(
                this.mesh,
                slot,
                data[offset] ?? 1,
                data[offset + 1] ?? 1,
                data[offset + 2] ?? 1,
                data[offset + 3] ?? 1
              );
              uploadedSlots++;
            }
          }
          return {
            calls: uploadedSlots,
            bytes: uploadedSlots * 4 * Float32Array.BYTES_PER_ELEMENT
          };
        }
      }
    });
    this.#colorStream = stream;
    return stream;
  }

  #syncDrawCount(): void {
    const drawCount = this.#visibleStrategy === "active-count" ? this.#slots.visibleCount : this.#slots.count;
    if (this.#batchDepth > 0) {
      this.#needsDrawCountSync = this.#needsDrawCountSync || drawCount !== this.#syncedDrawCount;
      return;
    }
    this.#applyDrawCount(drawCount);
    this.#colorStream?.flush(this.#slots.count);
  }

  #flushDrawCount(): void {
    if (!this.#needsDrawCountSync) {
      return;
    }
    this.#needsDrawCountSync = false;
    const drawCount = this.#visibleStrategy === "active-count" ? this.#slots.visibleCount : this.#slots.count;
    this.#applyDrawCount(drawCount);
  }

  #applyDrawCount(drawCount: number): void {
    if (drawCount === this.#syncedDrawCount) {
      return;
    }
    if (this.#dynamicDrawCount) {
      try {
        setThinInstanceDrawCount(this.mesh, drawCount);
      } catch (error) {
        if (error instanceof RangeError) {
          throw error;
        }
        setThinInstanceCount(this.mesh, drawCount);
      }
    } else {
      setThinInstanceCount(this.mesh, drawCount);
    }
    this.#syncedDrawCount = drawCount;
  }

  #markPostCountDirty(slot: number, colorAlreadyDirty: boolean): void {
    if (this.#batchDepth > 0) {
      this.#postCountDirtySlots.add(slot);
      if (!colorAlreadyDirty) this.#postCountColorDirtySlots.add(slot);
      return;
    }
    this.#markMatrixDirty(slot);
    if (!colorAlreadyDirty) this.#markColorDirty(slot);
  }

  #flushPostCountDirty(): void {
    for (const slot of this.#postCountDirtySlots) {
      this.#markMatrixDirty(slot);
    }
    this.#postCountDirtySlots.clear();
    for (const slot of this.#postCountColorDirtySlots) this.#markColorDirty(slot);
    this.#postCountColorDirtySlots.clear();
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

  #assertUsable(): void {
    if (this.#disposed) {
      throw new InstancerError("InstanceSet has been disposed");
    }
  }
}
