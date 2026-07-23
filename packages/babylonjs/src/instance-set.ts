import type { AbstractEngine } from "@babylonjs/core/Engines/abstractEngine.js";
import type { Mesh } from "@babylonjs/core/Meshes/mesh.js";
import { registerThinInstanceSupport } from "./babylon-registration.js";
import { assertValidCapacity, InstancerError } from "./errors.js";
import {
  prepareBoundsOwnership,
  refreshMeshBounds,
  restoreBoundsOwnership,
  type MeshBoundsOwnership
} from "./bounds.js";
import { InstanceSlotStore } from "./slot-store.js";
import { readMatrixPosition, swapMatrix16, translateMatrixPosition, writeMatrixPosition, writeMatrixScale } from "./matrix-buffer.js";
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
import { MeshWorldMatrixAdapter } from "./world-matrix-adapter.js";
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
  type InstanceBounds,
  type InstanceBoundsMode,
  type InstanceId,
  type InstanceMatrixUpdate,
  type InstanceMetadataPredicate,
  type InstanceMetadataUpdater,
  type InstanceSetOptions,
  type InstanceSlotEntry,
  type InstanceTransformInput,
  type InstanceTransformUpdate,
  type RawInstanceWriter,
  type Mat4,
  type Vec3Like
} from "./types.js";

registerThinInstanceSupport();

/**
 * Stable-ID manager for thin instances of one Babylon.js mesh.
 *
 * `InstanceSet` owns the thin instance matrix buffer and optional color buffer. It keeps a stable
 * `InstanceId` for each app object while allowing the underlying slot order to change for removal,
 * visibility packing, or growth.
 */
export interface InstanceSet<TMetadata = unknown> extends BaseInstanceSet<TMetadata> {
  /** Backing Babylon.js mesh. */
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
  return new BabylonInstanceSet<TMetadata>(mesh, options);
}

class BabylonInstanceSet<TMetadata> implements ColoredInstanceSet<TMetadata> {
  readonly mesh: Mesh;

  #capacity: number;
  #slots = new InstanceSlotStore<TMetadata>("instance");
  #matrices: Float32Array;
  #gpuMatrices: Float32Array;
  #matrixAdapter: MeshWorldMatrixAdapter;
  #colors: Float32Array | undefined;
  #colorStream: SlotAlignedFloatStream | undefined;
  #matrixScratch = new Float32Array(16);
  #hiddenMatrices = new Map<InstanceId, Mat4>();
  #visibleStrategy: "active-count" | "scale-zero";
  #grow: "none" | "double" | "exact";
  #engine: AbstractEngine;
  #batchDepth = 0;
  #dirtyMatrices = new Set<number>();
  #needsCountSync = false;
  #disposed = false;
  #boundsMode: InstanceBoundsMode;
  #fixedBounds: InstanceBounds | undefined;
  #boundsOwnership: MeshBoundsOwnership;

  constructor(mesh: Mesh, options: InstanceSetOptions) {
    this.mesh = mesh;
    this.#capacity = options.capacity ?? 128;
    assertValidCapacity(this.#capacity);
    this.#grow = options.grow ?? "double";
    this.#boundsMode = options.boundsMode ?? "auto";
    this.#fixedBounds = options.fixedBounds;
    this.#boundsOwnership = prepareBoundsOwnership(this.mesh, this.#boundsMode, this.#fixedBounds);
    this.#engine = this.mesh.getEngine();
    if (options.engine && options.engine !== this.#engine) {
      throw new InstancerError("InstanceSet engine does not match the mesh engine");
    }
    if (options.gpuCulling) {
      throw new InstancerError("gpuCulling is not supported by the Babylon.js adapter");
    }
    this.#visibleStrategy = options.visibleStrategy ?? "active-count";
    this.#matrices = new Float32Array(this.#capacity * 16);
    this.#gpuMatrices = new Float32Array(this.#capacity * 16);
    this.#matrixAdapter = new MeshWorldMatrixAdapter(this.mesh);
    registerSlotStreamHost(this, this.#capacity);
    this.mesh.thinInstanceSetBuffer("matrix", this.#gpuMatrices, 16, false);
    this.mesh.thinInstanceCount = 0;
    if (this.#boundsMode === "fixed") refreshMeshBounds(this.mesh, this.#boundsMode, this.#fixedBounds);

    if (options.colors) {
      this.#ensureColorStream();
    }
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
    this.#markMatrixDirty(this.#slots.requireSlot(id));
    this.#syncDrawCount();
    return id;
  }

  createMany(items: Iterable<InstanceCreateInput<TMetadata>>): InstanceId[] {
    this.#assertUsable();
    const inputs = Array.from(items);
    this.reserve(this.#slots.count + inputs.length);
    const ids: InstanceId[] = [];
    this.batch(() => {
      for (const item of inputs) ids.push(this.create(item.transform, item.metadata));
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
      for (const id of ids) if (this.remove(id)) removed++;
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
    this.#assertUsable();
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
    const slot = this.#slots.requireSlot(id);
    const hidden = this.#hiddenMatrices.get(id);
    return hidden ? getMat4Position(hidden, out) : readMatrixPosition(this.#matrices, slot * 16, out);
  }

  getPositionOrUndefined(id: InstanceId, out?: Float32Array): Float32Array | undefined {
    return this.has(id) ? this.getPosition(id, out) : undefined;
  }

  setPosition(id: InstanceId, position: Vec3Like): void {
    const slot = this.#slots.requireSlot(id);
    const hidden = this.#hiddenMatrices.get(id);
    if (hidden) {
      this.#hiddenMatrices.set(id, withMat4Position(hidden, position));
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
    const slot = this.#slots.requireSlot(id);
    const hidden = this.#hiddenMatrices.get(id);
    if (hidden) {
      this.#hiddenMatrices.set(id, translateMat4(hidden, delta));
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
    const slot = this.#slots.requireSlot(id);
    const hidden = this.#hiddenMatrices.get(id);
    if (hidden) {
      this.#hiddenMatrices.set(id, withMat4Scale(hidden, scale));
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
      if (this.#slots.setActiveCountVisible(id, visible, (a, b) => this.#swapSlotBuffers(a, b))) {
        if (visible) {
          const visibleSlot = this.#slots.requireSlot(id);
          this.#markMatrixDirty(visibleSlot);
          this.#markColorDirty(visibleSlot);
        }
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
    this.#assertUsable();
    return this.#slots.getMetadata(id);
  }

  setMetadata(id: InstanceId, metadata: TMetadata): void {
    this.#assertUsable();
    this.#slots.setMetadata(id, metadata);
  }

  trySetMetadata(id: InstanceId, metadata: TMetadata): boolean {
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
    if (this.#batchDepth === 0) stream.flush(this.#slots.count);
  }

  getColor(id: InstanceId, out = new Float32Array(4)): Float32Array {
    this.#assertUsable();
    const slot = this.#slots.requireSlot(id);
    if (!this.#colorStream) {
      out.fill(1);
      return out;
    }
    return this.#colorStream.getSlot(slot, out);
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
        this.#flushDirty();
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
      if (this.#batchDepth === 0) {
        this.#flushDirty();
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

  refreshBounds(): void {
    this.#assertUsable();
    refreshMeshBounds(this.mesh, this.#boundsMode, this.#fixedBounds);
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#slots.clear();
    this.#hiddenMatrices.clear();
    notifySlotsCleared(this);
    disposeSlotStreamHost(this);
    this.mesh.thinInstanceSetBuffer("matrix", null);
    restoreBoundsOwnership(this.mesh, this.#boundsOwnership);
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
    this.#gpuMatrices = new Float32Array(capacity * 16);
    this.#matrixAdapter.prepare();
    for (let slot = 0; slot < this.#slots.count; slot++) {
      this.#matrixAdapter.writeSlotPrepared(this.#matrices, this.#gpuMatrices, slot);
    }
    this.#capacity = capacity;
    this.mesh.thinInstanceSetBuffer("matrix", this.#gpuMatrices, 16, false);
    notifySlotCapacity(this, capacity);

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
      this.#dirtyMatrices.add(slot);
      this.#flushDirtyIfReady();
    }
  }

  #markColorDirty(slot: number): void {
    if (!this.#colorStream) return;
    this.#colorStream.markDirty(slot);
    if (this.#batchDepth === 0) this.#colorStream.flush(this.#slots.count);
  }

  #syncDrawCount(): void {
    this.#needsCountSync = true;
    this.#flushDirtyIfReady();
  }

  #flushDirtyIfReady(): void {
    if (this.#batchDepth === 0) this.#flushDirty();
  }

  #flushDirty(): void {
    const refreshBounds = this.#needsCountSync || this.#dirtyMatrices.size > 0;
    if (this.#needsCountSync) {
      this.#needsCountSync = false;
      this.mesh.thinInstanceCount = this.#visibleStrategy === "active-count" ? this.#slots.visibleCount : this.#slots.count;
    }
    if (this.#dirtyMatrices.size > 0) {
      this.#matrixAdapter.prepare();
      for (const slot of this.#dirtyMatrices) {
        this.#matrixAdapter.writeSlotPrepared(this.#matrices, this.#gpuMatrices, slot);
      }
    }
    this.#uploadRanges("matrix", this.#dirtyMatrices);
    this.#colorStream?.flush(this.#slots.count);
    if (refreshBounds && this.#boundsMode === "auto") this.refreshBounds();
  }

  #uploadRanges(kind: "matrix", dirty: Set<number>): void {
    if (dirty.size === 0) return;
    const slots = Array.from(dirty).sort((a, b) => a - b);
    dirty.clear();
    let start = slots[0] as number;
    let end = start;
    for (let index = 1; index <= slots.length; index++) {
      const slot = slots[index];
      if (slot === end + 1) {
        end = slot;
        continue;
      }
      this.mesh.thinInstancePartialBufferUpdate(kind, end - start + 1, start);
      if (slot !== undefined) start = end = slot;
    }
  }

  #ensureColorStream(): SlotAlignedFloatStream {
    if (this.#colorStream) return this.#colorStream;
    const stream = createHostSlotStream(this, {
      components: 4,
      defaultValue: [1, 1, 1, 1],
      backend: {
        bind: (data) => {
          this.#colors = data;
          this.mesh.thinInstanceSetBuffer("color", data, 4, false);
        },
        upload: (_data, count, ranges) => {
          let calls = 0;
          let bytes = 0;
          for (const range of ranges) {
            const end = Math.min(range.end, count - 1);
            if (end < range.start) continue;
            const length = end - range.start + 1;
            this.mesh.thinInstancePartialBufferUpdate("color", length, range.start);
            calls++;
            bytes += length * 4 * Float32Array.BYTES_PER_ELEMENT;
          }
          return { calls, bytes };
        },
        dispose: () => {
          this.mesh.thinInstanceSetBuffer("color", null);
          this.#colors = undefined;
        }
      }
    });
    this.#colorStream = stream;
    return stream;
  }

  #assertUsable(): void {
    if (this.#disposed) throw new InstancerError("InstanceSet has been disposed");
  }
}
