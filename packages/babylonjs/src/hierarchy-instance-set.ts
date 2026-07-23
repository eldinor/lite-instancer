import type { Mesh } from "@babylonjs/core/Meshes/mesh.js";
import type { Node } from "@babylonjs/core/node.js";
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
  type HierarchyInstanceSetOptions,
  type InstanceBounds,
  type InstanceBoundsMode,
  type InstanceBatchWriter,
  type InstanceId,
  type InstanceMatrixUpdate,
  type InstanceMetadataPredicate,
  type InstanceMetadataUpdater,
  type Mat4,
  type InstanceSlotEntry,
  type InstanceTransformInput,
  type InstanceTransformUpdate,
  type RawInstanceWriter,
  type Vec3Like
} from "./types.js";

registerThinInstanceSupport();

/**
 * Stable-ID manager for a rigid Babylon.js hierarchy rendered with synchronized thin instances.
 *
 * Use this for GLB roots or any scene-node tree that should be repeated as one logical object.
 * Slot order can change for removal and active-count visibility, but IDs remain stable.
 */
export interface HierarchyInstanceSet<TMetadata = unknown> extends BaseInstanceSet<TMetadata> {
  /** Source root used to discover the rigid renderable hierarchy. */
  readonly root: Node;
  /** Renderable descendants sharing the logical instance slot layout. */
  readonly meshes: readonly Mesh[];
}

/** Create a stable-ID manager for instances of a full scene-node hierarchy. */
export function createHierarchyInstanceSet<TMetadata = unknown>(
  root: Node,
  options: HierarchyInstanceSetOptions = {}
): HierarchyInstanceSet<TMetadata> {
  return new BabylonHierarchyInstanceSet<TMetadata>(root, options);
}

class BabylonHierarchyInstanceSet<TMetadata> implements HierarchyInstanceSet<TMetadata> {
  readonly root: Node;
  readonly meshes: readonly Mesh[];

  #capacity: number;
  #slots = new InstanceSlotStore<TMetadata>("hierarchy instance");
  #matrices: Float32Array;
  #gpuMatrices = new Map<Mesh, Float32Array>();
  #matrixAdapters = new Map<Mesh, MeshWorldMatrixAdapter>();
  #hiddenMatrices = new Map<InstanceId, Mat4>();
  #visibleStrategy: "active-count" | "scale-zero";
  #grow: "none" | "rebuild";
  #batchDepth = 0;
  #dirtySlots = new Set<number>();
  #needsCountSync = false;
  #matrixScratch = new Float32Array(16);
  #disposed = false;
  #boundsMode: InstanceBoundsMode;
  #fixedBounds: InstanceBounds | undefined;
  #boundsOwnership = new Map<Mesh, MeshBoundsOwnership>();

  constructor(root: Node, options: HierarchyInstanceSetOptions) {
    this.root = root;
    this.meshes = collectMeshes(root);
    if (this.meshes.length === 0) {
      throw new InstancerError("HierarchyInstanceSet root has no renderable meshes");
    }
    for (const mesh of this.meshes) {
      if (mesh.skeleton || mesh.morphTargetManager) {
        throw new InstancerError(`HierarchyInstanceSet only supports rigid meshes; '${mesh.name}' is animated`);
      }
      if (options.engine && mesh.getEngine() !== options.engine) {
        throw new InstancerError("HierarchyInstanceSet engine does not match a hierarchy mesh engine");
      }
    }
    if (options.gpuCulling) {
      throw new InstancerError("gpuCulling is not supported by the Babylon.js adapter");
    }
    this.#capacity = options.capacity ?? 128;
    assertValidCapacity(this.#capacity);
    this.#grow = options.grow ?? "none";
    this.#visibleStrategy = options.visibleStrategy ?? "active-count";
    this.#boundsMode = options.boundsMode ?? "auto";
    this.#fixedBounds = options.fixedBounds;
    this.#matrices = new Float32Array(this.#capacity * 16);
    for (const mesh of this.meshes) {
      this.#boundsOwnership.set(mesh, prepareBoundsOwnership(mesh, this.#boundsMode, this.#fixedBounds));
      const gpuMatrices = new Float32Array(this.#capacity * 16);
      this.#gpuMatrices.set(mesh, gpuMatrices);
      this.#matrixAdapters.set(mesh, new MeshWorldMatrixAdapter(mesh));
      mesh.thinInstanceSetBuffer("matrix", gpuMatrices, 16, false);
      mesh.thinInstanceCount = 0;
      if (this.#boundsMode === "fixed") refreshMeshBounds(mesh, this.#boundsMode, this.#fixedBounds);
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
      for (const item of inputs) ids.push(this.create(item.transform, item.metadata));
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
      for (const id of ids) if (this.remove(id)) removed++;
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
    this.#assertUsable();
    const slot = this.#slots.requireSlot(id);
    const hidden = this.#hiddenMatrices.get(id);
    return hidden ? getMat4Position(hidden, out) : readMatrixPosition(this.#matrices, slot * 16, out);
  }

  getPositionOrUndefined(id: InstanceId, out?: Float32Array): Float32Array | undefined {
    return this.has(id) ? this.getPosition(id, out) : undefined;
  }

  setPosition(id: InstanceId, position: Vec3Like): void {
    this.#assertUsable();
    const slot = this.#slots.requireSlot(id);
    const hidden = this.#hiddenMatrices.get(id);
    if (hidden) {
      this.#hiddenMatrices.set(id, withMat4Position(hidden, position));
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
      this.#hiddenMatrices.set(id, translateMat4(hidden, delta));
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
      this.#hiddenMatrices.set(id, withMat4Scale(hidden, scale));
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

  refreshBounds(): void {
    this.#assertUsable();
    for (const mesh of this.meshes) refreshMeshBounds(mesh, this.#boundsMode, this.#fixedBounds);
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#slots.clear();
    this.#hiddenMatrices.clear();
    for (const mesh of this.meshes) {
      mesh.thinInstanceSetBuffer("matrix", null);
      restoreBoundsOwnership(mesh, this.#boundsOwnership.get(mesh)!);
    }
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
    for (const mesh of this.meshes) {
      const gpuMatrices = new Float32Array(capacity * 16);
      const adapter = this.#matrixAdapters.get(mesh)!;
      adapter.prepare();
      for (let slot = 0; slot < this.#slots.count; slot++) adapter.writeSlotPrepared(this.#matrices, gpuMatrices, slot);
      this.#gpuMatrices.set(mesh, gpuMatrices);
      mesh.thinInstanceSetBuffer("matrix", gpuMatrices, 16, false);
    }
    this.#syncVisiblePool();
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
    const refreshBounds = this.#needsCountSync || this.#dirtySlots.size > 0;
    if (this.#needsCountSync) {
      this.#needsCountSync = false;
      this.#syncHierarchyCount();
    }
    const drawCount = this.#visibleStrategy === "active-count" ? this.#slots.visibleCount : this.#slots.count;
    if (this.#dirtySlots.size > 0) {
      for (const mesh of this.meshes) {
        const adapter = this.#matrixAdapters.get(mesh)!;
        const gpuMatrices = this.#gpuMatrices.get(mesh)!;
        adapter.prepare();
        for (const slot of this.#dirtySlots) {
          if (slot < drawCount) adapter.writeSlotPrepared(this.#matrices, gpuMatrices, slot);
        }
      }
      this.#uploadDirtyRanges(drawCount);
    }
    this.#dirtySlots.clear();
    if (refreshBounds && this.#boundsMode === "auto") this.refreshBounds();
  }

  #syncHierarchyCount(): void {
    const drawCount = this.#visibleStrategy === "active-count" ? this.#slots.visibleCount : this.#slots.count;
    for (const mesh of this.meshes) mesh.thinInstanceCount = drawCount;
  }

  #syncVisiblePool(): void {
    this.#dirtySlots.clear();
    this.#needsCountSync = false;
    this.#syncHierarchyCount();
    const drawCount = this.#visibleStrategy === "active-count" ? this.#slots.visibleCount : this.#slots.count;
    if (drawCount > 0) {
      for (const mesh of this.meshes) mesh.thinInstancePartialBufferUpdate("matrix", drawCount, 0);
    }
    if (drawCount > 0 && this.#boundsMode === "auto") this.refreshBounds();
  }

  #uploadDirtyRanges(drawCount: number): void {
    const slots = Array.from(this.#dirtySlots).filter((slot) => slot < drawCount).sort((a, b) => a - b);
    if (slots.length === 0) return;
    let start = slots[0] as number;
    let end = start;
    for (let index = 1; index <= slots.length; index++) {
      const slot = slots[index];
      if (slot === end + 1) {
        end = slot;
        continue;
      }
      for (const mesh of this.meshes) mesh.thinInstancePartialBufferUpdate("matrix", end - start + 1, start);
      if (slot !== undefined) start = end = slot;
    }
  }

  #assertUsable(): void {
    if (this.#disposed) throw new InstancerError("HierarchyInstanceSet has been disposed");
  }

}

function collectMeshes(root: Node): Mesh[] {
  const meshes: Mesh[] = [];
  const stack: Node[] = [root];
  while (stack.length > 0) {
    const node = stack.pop();
    if (!node) {
      continue;
    }
    if (isMesh(node)) {
      meshes.push(node);
    }
    stack.push(...node.getChildren());
  }
  return meshes;
}

function isMesh(node: Node): node is Mesh {
  return "thinInstanceSetBuffer" in node && "material" in node;
}
