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
import { assertKnownId, assertValidCapacity, InstancerError } from "./errors.js";
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
  type Vec3Like,
  toInstanceId
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
  #count = 0;
  #visibleCount = 0;
  #nextId = 1;
  #matrices: Float32Array;
  #idToSlot = new Map<InstanceId, number>();
  #slotToId: InstanceId[] = [];
  #metadata = new Map<InstanceId, TMetadata>();
  #hiddenMatrices = new Map<InstanceId, Mat4>();
  #visibleStrategy: "active-count" | "scale-zero";
  #grow: "none" | "rebuild";
  #gpuCulling: boolean;
  #engine: EngineContext | undefined;
  #batchDepth = 0;
  #needsBundleInvalidation = false;

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
    this.#syncVisiblePool();
    return id;
  }

  createMany(items: Iterable<InstanceCreateInput<TMetadata>>): InstanceId[] {
    const inputs = Array.from(items);
    this.reserve(this.#count + inputs.length);
    return inputs.map((item) => this.create(item.transform, item.metadata));
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
    this.#syncVisiblePool();
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
    this.#count = 0;
    this.#visibleCount = 0;
    this.#slotToId = [];
    this.#idToSlot.clear();
    this.#metadata.clear();
    this.#hiddenMatrices.clear();
    this.#syncVisiblePool();
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

  *ids(): IterableIterator<InstanceId> {
    for (let slot = 0; slot < this.#count; slot++) {
      const id = this.#slotToId[slot];
      if (id !== undefined) {
        yield id;
      }
    }
  }

  *visibleIds(): IterableIterator<InstanceId> {
    for (let slot = 0; slot < this.#count; slot++) {
      const id = this.#slotToId[slot];
      if (id !== undefined && this.getVisible(id)) {
        yield id;
      }
    }
  }

  *slots(): IterableIterator<InstanceSlotEntry> {
    for (let slot = 0; slot < this.#count; slot++) {
      const id = this.#slotToId[slot];
      if (id !== undefined) {
        yield { id, slot };
      }
    }
  }

  *entries(): IterableIterator<InstanceEntry<TMetadata>> {
    for (const { id, slot } of this.slots()) {
      const metadata = this.#metadata.get(id);
      if (metadata === undefined) {
        yield { id, slot };
      } else {
        yield { id, slot, metadata };
      }
    }
  }

  forEach(callback: (id: InstanceId, slot: number) => void): void {
    for (const { id, slot } of this.slots()) {
      callback(id, slot);
    }
  }

  setMatrix(id: InstanceId, matrix: Mat4): void {
    const slot = assertKnownId(id, this.#idToSlot.get(id));
    if (this.#visibleStrategy === "scale-zero" && !this.getVisible(id)) {
      this.#hiddenMatrices.set(id, copyMat4(matrix));
      return;
    }
    this.#writeMatrixAt(slot, matrix);
    this.#syncSlotIfVisible(slot);
  }

  trySetMatrix(id: InstanceId, matrix: Mat4): boolean {
    if (!this.has(id)) {
      return false;
    }
    this.setMatrix(id, matrix);
    return true;
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
    const slot = assertKnownId(id, this.#idToSlot.get(id));
    if (this.#visibleStrategy === "active-count") {
      return slot < this.#visibleCount;
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
      this.#syncVisiblePool();
      return;
    }

    if (visible) {
      const original = this.#hiddenMatrices.get(id);
      if (!original) {
        return;
      }
      this.#hiddenMatrices.delete(id);
      this.#writeMatrixAt(slot, original);
      this.#syncVisiblePool();
      return;
    }

    if (!this.#hiddenMatrices.has(id)) {
      const original = this.getMatrix(id);
      this.#hiddenMatrices.set(id, original);
      this.#writeMatrixAt(slot, writeZeroScale(original));
      this.#syncVisiblePool();
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
    return this.#metadata.get(id);
  }

  setMetadata(id: InstanceId, metadata: TMetadata): void {
    assertKnownId(id, this.#idToSlot.get(id));
    this.#metadata.set(id, metadata);
  }

  trySetMetadata(id: InstanceId, metadata: TMetadata): boolean {
    if (!this.has(id)) {
      return false;
    }
    this.setMetadata(id, metadata);
    return true;
  }

  findByMetadata(predicate: InstanceMetadataPredicate<TMetadata>): InstanceId | undefined {
    for (const { id, slot } of this.slots()) {
      const metadata = this.#metadata.get(id);
      if (metadata !== undefined && predicate(metadata, id, slot)) {
        return id;
      }
    }
    return undefined;
  }

  filterByMetadata(predicate: InstanceMetadataPredicate<TMetadata>): InstanceId[] {
    const ids: InstanceId[] = [];
    for (const { id, slot } of this.slots()) {
      const metadata = this.#metadata.get(id);
      if (metadata !== undefined && predicate(metadata, id, slot)) {
        ids.push(id);
      }
    }
    return ids;
  }

  updateMetadata(id: InstanceId, updater: InstanceMetadataUpdater<TMetadata>): TMetadata | undefined {
    assertKnownId(id, this.#idToSlot.get(id));
    const next = updater(this.#metadata.get(id), id);
    if (next === undefined) {
      this.#metadata.delete(id);
      return undefined;
    }
    this.#metadata.set(id, next);
    return next;
  }

  tryUpdateMetadata(id: InstanceId, updater: InstanceMetadataUpdater<TMetadata>): TMetadata | undefined {
    if (!this.has(id)) {
      return undefined;
    }
    return this.updateMetadata(id, updater);
  }

  deleteMetadata(id: InstanceId): boolean {
    return this.#metadata.delete(id);
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
      this.#syncVisiblePool();
    } finally {
      this.#batchDepth--;
      if (this.#batchDepth === 0) {
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
        markMatrixDirty: (slot) => this.#syncSlotIfVisible(slot),
        markColorDirty: () => undefined
      });
      this.#syncVisiblePool();
    } finally {
      this.#batchDepth--;
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
    nextMatrices.set(this.#matrices.subarray(0, this.#count * 16));
    this.#matrices = nextMatrices;
    this.#capacity = capacity;
    clearThinInstances(this.root);
    this.#pool = createHierarchyInstancePool(this.root, this.#capacity);
    this.#applyGpuCulling();
    this.#syncVisiblePool();
    this.#requestBundleInvalidation();
  }

  #swapSlots(a: number, b: number): void {
    if (a === b) {
      return;
    }
    const aId = this.#slotToId[a];
    const bId = this.#slotToId[b];
    if (aId === undefined || bId === undefined) {
      throw new InstancerError("Cannot swap empty hierarchy instance slots");
    }
    const aStart = a * 16;
    const bStart = b * 16;
    const tmp = this.#matrices.slice(aStart, aStart + 16);
    this.#matrices.copyWithin(aStart, bStart, bStart + 16);
    this.#matrices.set(tmp, bStart);
    this.#slotToId[a] = bId;
    this.#slotToId[b] = aId;
    this.#idToSlot.set(aId, b);
    this.#idToSlot.set(bId, a);
  }

  #writeMatrixAt(slot: number, matrix: Mat4): void {
    this.#matrices.set(matrix, slot * 16);
  }

  #syncSlotIfVisible(slot: number): void {
    const drawCount = this.#visibleStrategy === "active-count" ? this.#visibleCount : this.#count;
    if (slot >= drawCount) {
      return;
    }
    setHierarchyInstanceMatrix(this.#pool, slot, this.#matrices.subarray(slot * 16, slot * 16 + 16) as Mat4);
    this.#requestBundleInvalidation();
  }

  #syncVisiblePool(): void {
    const drawCount = this.#visibleStrategy === "active-count" ? this.#visibleCount : this.#count;
    setHierarchyInstanceCount(this.#pool, drawCount);
    this.#requestBundleInvalidation();
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
