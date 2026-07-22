import {
  createHierarchyInstancePool,
  enableThinInstanceGpuCulling,
  invalidateRenderBundles,
  setHierarchyInstanceCount,
  setHierarchyInstanceMatrix,
  type EngineContext,
  type HierarchyInstancePool,
  type Mat4,
  type Mesh,
  type SceneNode
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
import { composeMat4 } from "./transforms.js";
import {
  type BaseInstanceSet,
  type InstanceCreateInput,
  type InstanceEntry,
  type HierarchyInstanceSetOptions,
  type InstanceBatchWriter,
  type InstanceId,
  type InstanceMatrixUpdate,
  type InstanceMetadataPredicate,
  type InstanceMetadataUpdater,
  type InstanceSlotEntry,
  type InstanceTransformInput,
  type InstanceTransformUpdate,
  type RawInstanceWriter,
  type Vec3Like
} from "./types.js";

/**
 * Stable-ID manager for a Babylon Lite hierarchy instance pool.
 *
 * Use this for GLB roots or any scene-node tree that should be repeated as one logical object.
 * Slot order can change for removal and active-count visibility, but IDs remain stable.
 */
export interface HierarchyInstanceSet<TMetadata = unknown> extends BaseInstanceSet<TMetadata> {
  /** Source root used to create the hierarchy pool. The caller retains ownership of its nodes and resources. */
  readonly root: SceneNode;
  /** Current Babylon Lite hierarchy pool. May be replaced when `grow: "rebuild"` is used. */
  readonly pool: HierarchyInstancePool;
}

/** Create a stable-ID manager for instances of a full scene-node hierarchy. */
export function createHierarchyInstanceSet<TMetadata = unknown>(
  root: SceneNode,
  options: HierarchyInstanceSetOptions = {}
): HierarchyInstanceSet<TMetadata> {
  return new LiteHierarchyInstanceSet<TMetadata>(root, options);
}

class LiteHierarchyInstanceSet<TMetadata> implements HierarchyInstanceSet<TMetadata> {
  readonly root: SceneNode;

  #pool: HierarchyInstancePool;
  #capacity: number;
  #slots = new InstanceSlotStore<TMetadata>("hierarchy instance");
  #matrices: Float32Array;
  #matrixScratch = new Float32Array(16);
  #hiddenMatrices = new Map<InstanceId, Mat4>();
  #visibleStrategy: "active-count" | "scale-zero";
  #grow: "none" | "rebuild";
  #gpuCulling: boolean;
  #engine: EngineContext | undefined;
  #batchDepth = 0;
  #needsBundleInvalidation = false;
  #dirtySlots = new Set<number>();
  #needsCountSync = false;
  #ownedThinInstances = new Map<Mesh, Mesh["thinInstances"]>();
  #disposed = false;

  constructor(root: SceneNode, options: HierarchyInstanceSetOptions) {
    this.root = root;
    this.#capacity = options.capacity ?? 128;
    assertValidCapacity(this.#capacity);
    this.#grow = options.grow ?? "none";
    this.#engine = options.engine;
    this.#visibleStrategy = options.visibleStrategy ?? "active-count";
    this.#gpuCulling = options.gpuCulling ?? false;
    this.#matrices = new Float32Array(this.#capacity * 16);
    this.#pool = createHierarchyInstancePool(this.root, this.#capacity);
    this.#captureOwnedThinInstances();
    this.#applyGpuCulling();
    setHierarchyInstanceCount(this.#pool, 0);
  }

  get pool(): HierarchyInstancePool {
    this.#assertUsable();
    return this.#pool;
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
    this.#writeMatrixAt(slot, matrix);
    this.#markCountDirty();
    this.setVisible(id, true);
    this.#markSlotDirty(slot);
    this.#flushDirtyIfReady();
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
    const removed = this.#slots.remove(id, (a, b) => this.#swapSlotBuffers(a, b));
    if (!removed) {
      return false;
    }
    this.#hiddenMatrices.delete(id);
    this.#markCountDirty();
    this.#flushDirtyIfReady();
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
    this.#syncVisiblePool();
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
    this.#markSlotDirty(slot);
    this.#flushDirtyIfReady();
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
    this.#markSlotDirty(slot);
    this.#flushDirtyIfReady();
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
    this.#markSlotDirty(slot);
    this.#flushDirtyIfReady();
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
    this.#markSlotDirty(slot);
    this.#flushDirtyIfReady();
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
        this.#markSlotDirty(this.#slots.requireSlot(id));
        this.#markCountDirty();
        this.#flushDirtyIfReady();
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
      this.#markCountDirty();
      this.#markSlotDirty(slot);
      this.#flushDirtyIfReady();
      return;
    }

    if (!this.#hiddenMatrices.has(id)) {
      const original = new Float32Array(16) as Mat4;
      copyMatrix16(this.#matrices, slot * 16, original as Float32Array);
      this.#hiddenMatrices.set(id, original);
      writeZeroMatrixScale(this.#matrices, slot * 16);
      this.#markCountDirty();
      this.#markSlotDirty(slot);
      this.#flushDirtyIfReady();
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
        setMetadata: (id, metadata) => this.setMetadata(id, metadata)
      });
    } finally {
      this.#batchDepth--;
      if (this.#batchDepth === 0) {
        this.#flushDirty();
        this.#flushBundleInvalidation();
      }
    }
  }

  editRaw(callback: (raw: RawInstanceWriter) => void): void {
    this.#assertUsable();
    this.#batchDepth++;
    try {
      callback({
        matrices: this.#matrices,
        getSlot: (id) => this.getSlot(id),
        writeMatrix: (id, matrix) => this.setMatrix(id, matrix),
        writeColor: () => {
          throw new InstancerError("HierarchyInstanceSet does not support per-instance colors yet");
        },
        markMatrixDirty: (slot) => this.#markSlotDirty(slot),
        markColorDirty: () => undefined
      });
    } finally {
      this.#batchDepth--;
      if (this.#batchDepth === 0) {
        this.#flushDirty();
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
    this.#rebuild(capacity);
  }

  dispose(): void {
    if (this.#disposed) {
      return;
    }
    this.#slots.clear();
    this.#hiddenMatrices.clear();
    this.#dirtySlots.clear();
    this.#needsCountSync = false;
    this.#detachOwnedThinInstances();
    this.#disposed = true;
  }

  #ensureCapacity(required: number): void {
    if (required <= this.#capacity) {
      return;
    }
    if (this.#grow === "none") {
      throw new InstancerError(`HierarchyInstanceSet capacity exceeded (${this.#capacity})`);
    }
    this.#rebuild(Math.max(required, Math.max(1, this.#capacity * 2)));
  }

  #rebuild(capacity: number): void {
    const nextMatrices = new Float32Array(capacity * 16);
    nextMatrices.set(this.#matrices.subarray(0, this.#slots.count * 16));
    this.#matrices = nextMatrices;
    this.#capacity = capacity;
    this.#detachOwnedThinInstances();
    this.#pool = createHierarchyInstancePool(this.root, this.#capacity);
    this.#captureOwnedThinInstances();
    this.#applyGpuCulling();
    this.#syncVisiblePool();
    this.#requestBundleInvalidation();
  }

  #swapSlotBuffers(a: number, b: number): void {
    const aStart = a * 16;
    const bStart = b * 16;
    swapMatrix16(this.#matrices, aStart, bStart, this.#matrixScratch);
    this.#markSlotDirty(a);
    this.#markSlotDirty(b);
  }

  #writeMatrixAt(slot: number, matrix: Mat4): void {
    this.#matrices.set(matrix, slot * 16);
  }

  #syncSlotIfVisible(slot: number): void {
    const drawCount = this.#visibleStrategy === "active-count" ? this.#slots.visibleCount : this.#slots.count;
    if (slot >= drawCount) {
      return;
    }
    copyMatrix16(this.#matrices, slot * 16, this.#matrixScratch);
    setHierarchyInstanceMatrix(this.#pool, slot, this.#matrixScratch as Mat4);
  }

  #markSlotDirty(slot: number): void {
    this.#dirtySlots.add(slot);
  }

  #markCountDirty(): void {
    this.#needsCountSync = true;
  }

  #flushDirtyIfReady(): void {
    if (this.#batchDepth === 0) {
      this.#flushDirty();
    }
  }

  #flushDirty(): void {
    if (this.#needsCountSync) {
      this.#needsCountSync = false;
      this.#syncHierarchyCount();
    }
    for (const slot of this.#dirtySlots) {
      this.#syncSlotIfVisible(slot);
    }
    this.#dirtySlots.clear();
  }

  #syncHierarchyCount(): void {
    const drawCount = this.#visibleStrategy === "active-count" ? this.#slots.visibleCount : this.#slots.count;
    setHierarchyInstanceCount(this.#pool, drawCount);
  }

  #syncVisiblePool(): void {
    this.#dirtySlots.clear();
    this.#needsCountSync = false;
    this.#syncHierarchyCount();
    const drawCount = this.#visibleStrategy === "active-count" ? this.#slots.visibleCount : this.#slots.count;
    for (let slot = 0; slot < drawCount; slot++) {
      this.#syncSlotIfVisible(slot);
    }
  }

  #applyGpuCulling(): void {
    if (!this.#gpuCulling) {
      return;
    }
    for (const mesh of collectMeshes(this.root)) {
      if (mesh.thinInstances) {
        enableThinInstanceGpuCulling(mesh, true);
      }
    }
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

  #captureOwnedThinInstances(): void {
    this.#ownedThinInstances.clear();
    for (const mesh of collectMeshes(this.root)) {
      this.#ownedThinInstances.set(mesh, mesh.thinInstances);
    }
  }

  #detachOwnedThinInstances(): void {
    for (const [mesh, owned] of this.#ownedThinInstances) {
      if (mesh.thinInstances === owned) {
        mesh.thinInstances = null;
      }
    }
    this.#ownedThinInstances.clear();
  }

  #assertUsable(): void {
    if (this.#disposed) {
      throw new InstancerError("HierarchyInstanceSet has been disposed");
    }
  }
}

function collectMeshes(root: SceneNode): Mesh[] {
  const meshes: Mesh[] = [];
  const stack: SceneNode[] = [root];
  while (stack.length > 0) {
    const node = stack.pop();
    if (!node) {
      continue;
    }
    if (isMesh(node)) {
      meshes.push(node);
    }
    stack.push(...node.children);
  }
  return meshes;
}

function isMesh(node: SceneNode): node is Mesh {
  return "_gpu" in node && "material" in node;
}
