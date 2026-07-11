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
  /** Source root used to create the hierarchy pool. */
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
  #hiddenMatrices = new Map<InstanceId, Mat4>();
  #visibleStrategy: "active-count" | "scale-zero";
  #grow: "none" | "rebuild";
  #gpuCulling: boolean;
  #engine: EngineContext | undefined;
  #batchDepth = 0;
  #needsBundleInvalidation = false;
  #dirtySlots = new Set<number>();
  #needsCountSync = false;

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
    this.#applyGpuCulling();
    setHierarchyInstanceCount(this.#pool, 0);
  }

  get pool(): HierarchyInstancePool {
    return this.#pool;
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
    this.#markSlotDirty(slot);
    this.#flushDirtyIfReady();
    return id;
  }

  createMany(items: Iterable<InstanceCreateInput<TMetadata>>): InstanceId[] {
    const inputs = Array.from(items);
    this.reserve(this.#slots.count + inputs.length);
    return inputs.map((item) => this.create(item.transform, item.metadata));
  }

  remove(id: InstanceId): boolean {
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
    this.#syncVisiblePool();
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
      const original = this.getMatrix(id);
      this.#hiddenMatrices.set(id, original);
      this.#writeMatrixAt(slot, writeZeroScale(original));
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
    assertValidCapacity(capacity);
    if (capacity <= this.#capacity) {
      return;
    }
    this.#rebuild(capacity);
  }

  dispose(): void {
    this.clear();
    clearThinInstances(this.root);
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
    clearThinInstances(this.root);
    this.#pool = createHierarchyInstancePool(this.root, this.#capacity);
    this.#applyGpuCulling();
    this.#syncVisiblePool();
    this.#requestBundleInvalidation();
  }

  #swapSlotBuffers(a: number, b: number): void {
    const aStart = a * 16;
    const bStart = b * 16;
    const tmp = this.#matrices.slice(aStart, aStart + 16);
    this.#matrices.copyWithin(aStart, bStart, bStart + 16);
    this.#matrices.set(tmp, bStart);
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
    setHierarchyInstanceMatrix(this.#pool, slot, this.#matrices.subarray(slot * 16, slot * 16 + 16) as Mat4);
    this.#requestBundleInvalidation();
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
    this.#requestBundleInvalidation();
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
}

function clearThinInstances(root: SceneNode): void {
  for (const mesh of collectMeshes(root)) {
    mesh.thinInstances = null;
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
