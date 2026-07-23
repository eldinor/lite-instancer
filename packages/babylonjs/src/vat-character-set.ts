import type { AnimationGroup } from "@babylonjs/core/Animations/animationGroup.js";
import type { AbstractEngine } from "@babylonjs/core/Engines/abstractEngine.js";
import type { Mesh } from "@babylonjs/core/Meshes/mesh.js";
import type { Node } from "@babylonjs/core/node.js";
import type {
  InstanceEntry,
  InstanceId,
  InstanceMetadataPredicate,
  InstanceMetadataUpdater,
  InstanceSlotEntry,
  InstanceTransformInput,
  Mat4
} from "./types.js";
import {
  createVatInstanceSet,
  type VatClip,
  type VatInstanceCreateOptions,
  type VatInstanceSet,
  type VatInstanceSetOptions,
  type VatPlaybackSample,
  type VatPlaybackSource,
  type VatPlaybackUpdate,
  type VatPlaybackUpdateEntry
} from "./vat-instance-set.js";

export interface VatCharacterSetOptions extends VatInstanceSetOptions {}

export interface VatCharacterMeshPart {
  readonly mesh: Mesh;
}

export interface VatCharacterSet<TMetadata = unknown> extends VatPlaybackSource {
  readonly root: Node;
  readonly primary: VatInstanceSet<TMetadata>;
  readonly secondaryParts: readonly VatCharacterMeshPart[];
  readonly clips: Record<string, VatClip>;
  readonly activeClip: string | undefined;
  readonly timeSeconds: number;
  readonly count: number;
  readonly capacity: number;
  readonly visibleCount: number;
  create(options?: VatInstanceCreateOptions<TMetadata>): InstanceId;
  createMany(items: Iterable<VatInstanceCreateOptions<TMetadata>>): InstanceId[];
  remove(id: InstanceId): boolean;
  removeMany(ids: Iterable<InstanceId>): number;
  clear(): void;
  has(id: InstanceId): boolean;
  getSlot(id: InstanceId): number | undefined;
  getIdForSlot(slot: number): InstanceId | undefined;
  ids(): IterableIterator<InstanceId>;
  visibleIds(): IterableIterator<InstanceId>;
  slots(): IterableIterator<InstanceSlotEntry>;
  entries(): IterableIterator<InstanceEntry<TMetadata>>;
  forEach(callback: (id: InstanceId, slot: number) => void): void;
  getVisible(id: InstanceId): boolean;
  setVisible(id: InstanceId, visible: boolean): void;
  setVisibleMany(ids: Iterable<InstanceId>, visible: boolean): void;
  setMatrix(id: InstanceId, matrix: Mat4): void;
  setTransform(id: InstanceId, transform: InstanceTransformInput): void;
  getMatrix(id: InstanceId, out?: Mat4): Mat4;
  getPosition(id: InstanceId, out?: Float32Array): Float32Array;
  getPositionOrUndefined(id: InstanceId, out?: Float32Array): Float32Array | undefined;
  getMetadata(id: InstanceId): TMetadata | undefined;
  setMetadata(id: InstanceId, metadata: TMetadata): void;
  trySetMetadata(id: InstanceId, metadata: TMetadata): boolean;
  findByMetadata(predicate: InstanceMetadataPredicate<TMetadata>): InstanceId | undefined;
  filterByMetadata(predicate: InstanceMetadataPredicate<TMetadata>): InstanceId[];
  updateMetadata(id: InstanceId, updater: InstanceMetadataUpdater<TMetadata>): TMetadata | undefined;
  tryUpdateMetadata(id: InstanceId, updater: InstanceMetadataUpdater<TMetadata>): TMetadata | undefined;
  deleteMetadata(id: InstanceId): boolean;
  play(clip: string): boolean;
  update(deltaSeconds: number): void;
  setClip(id: InstanceId, clip: string | undefined): boolean;
  setPhaseOffset(id: InstanceId, offset: number): void;
  setFps(id: InstanceId, fps: number | undefined): void;
  setPlayback(id: InstanceId, update: VatPlaybackUpdate): boolean;
  setPlaybackMany(items: Iterable<VatPlaybackUpdateEntry>): number;
  batchPlayback<TResult>(callback: () => TResult): TResult;
  getPlaybackSample(id: InstanceId, out?: VatPlaybackSample): VatPlaybackSample | undefined;
  refreshBounds(): void;
  syncInstances(): void;
  dispose(): void;
}

interface SecondaryPart {
  readonly vat: VatInstanceSet<never>;
  readonly secondaryByPrimary: Map<InstanceId, InstanceId>;
}

/** Create one logical VAT character spanning every skinned mesh below `root`. */
export function createVatCharacterSet<TMetadata = unknown>(
  engine: AbstractEngine,
  root: Node,
  animationGroups: AnimationGroup[],
  options: VatCharacterSetOptions = {}
): VatCharacterSet<TMetadata> {
  const meshes = findSkinnedMeshes(root);
  const primaryMesh = meshes.shift();
  if (!primaryMesh) throw new Error("VAT character requires at least one skinned mesh.");
  if (animationGroups.length === 0) throw new Error("VAT character requires at least one animation group.");

  const primary = createVatInstanceSet<TMetadata>(engine, primaryMesh, animationGroups, options);
  const secondary: SecondaryPart[] = meshes.map((mesh) => ({
    vat: createVatInstanceSet<never>(engine, mesh, animationGroups, options),
    secondaryByPrimary: new Map()
  }));

  for (const part of secondary) {
    for (const clip of Object.keys(primary.clips)) {
      if (!part.vat.clips[clip]) throw new Error(`VAT character mesh '${part.vat.mesh.name}' is missing clip '${clip}'.`);
    }
  }

  const secondaryId = (part: SecondaryPart, id: InstanceId): InstanceId | undefined => part.secondaryByPrimary.get(id);
  const batchAllPlayback = <T>(callback: () => T): T => {
    const run = (index: number): T => {
      if (index === secondary.length) return callback();
      return secondary[index]!.vat.batchPlayback(() => run(index + 1));
    };
    return primary.batchPlayback(() => run(0));
  };

  const api: VatCharacterSet<TMetadata> = {
    root,
    primary,
    secondaryParts: secondary.map(({ vat }) => ({ mesh: vat.mesh })),
    clips: primary.clips,
    get activeClip() { return primary.activeClip; },
    get timeSeconds() { return primary.timeSeconds; },
    get count() { return primary.count; },
    get capacity() { return primary.capacity; },
    get visibleCount() { return primary.visibleCount; },
    create(createOptions = {}) {
      const id = primary.create(createOptions);
      for (const part of secondary) {
        const mirrored: VatInstanceCreateOptions<never> = {};
        if (createOptions.transform !== undefined) mirrored.transform = createOptions.transform;
        if (createOptions.clip !== undefined) mirrored.clip = createOptions.clip;
        if (createOptions.offset !== undefined) mirrored.offset = createOptions.offset;
        if (createOptions.fps !== undefined) mirrored.fps = createOptions.fps;
        const sid = part.vat.create(mirrored);
        part.secondaryByPrimary.set(id, sid);
      }
      return id;
    },
    createMany(items) {
      const inputs = Array.from(items);
      return batchAllPlayback(() => {
        const ids = primary.createMany(inputs);
        for (const part of secondary) {
          const secondaryIds = part.vat.createMany(inputs.map((item) => ({
            ...(item.transform === undefined ? {} : { transform: item.transform }),
            ...(item.clip === undefined ? {} : { clip: item.clip }),
            ...(item.offset === undefined ? {} : { offset: item.offset }),
            ...(item.fps === undefined ? {} : { fps: item.fps })
          })));
          for (let index = 0; index < ids.length; index++) {
            part.secondaryByPrimary.set(ids[index]!, secondaryIds[index]!);
          }
        }
        return ids;
      });
    },
    remove(id) {
      if (!primary.remove(id)) return false;
      for (const part of secondary) {
        const sid = secondaryId(part, id);
        if (sid !== undefined) part.vat.remove(sid);
        part.secondaryByPrimary.delete(id);
      }
      return true;
    },
    removeMany(ids) {
      return batchAllPlayback(() => {
        const candidates = Array.from(ids);
        const live = candidates.filter((id) => primary.has(id));
        const removed = primary.removeMany(candidates);
        for (const part of secondary) {
          const secondaryIds: InstanceId[] = [];
          for (const id of live) {
            const sid = part.secondaryByPrimary.get(id);
            if (sid !== undefined) secondaryIds.push(sid);
          }
          part.vat.removeMany(secondaryIds);
          for (const id of live) part.secondaryByPrimary.delete(id);
        }
        return removed;
      });
    },
    clear() {
      primary.clear();
      for (const part of secondary) {
        part.vat.clear();
        part.secondaryByPrimary.clear();
      }
    },
    has: (id) => primary.has(id),
    getSlot: (id) => primary.getSlot(id),
    getIdForSlot: (slot) => primary.getIdForSlot(slot),
    ids: () => primary.ids(),
    visibleIds: () => primary.visibleIds(),
    slots: () => primary.slots(),
    entries: () => primary.entries(),
    forEach: (callback) => primary.forEach(callback),
    getVisible: (id) => primary.getVisible(id),
    setVisible(id, visible) {
      primary.setVisible(id, visible);
      for (const part of secondary) {
        const sid = secondaryId(part, id);
        if (sid !== undefined) part.vat.setVisible(sid, visible);
      }
    },
    setVisibleMany(ids, visible) {
      const primaryIds = Array.from(ids);
      primary.setVisibleMany(primaryIds, visible);
      for (const part of secondary) {
        const secondaryIds: InstanceId[] = [];
        for (const id of primaryIds) {
          const sid = secondaryId(part, id);
          if (sid !== undefined) secondaryIds.push(sid);
        }
        part.vat.setVisibleMany(secondaryIds, visible);
      }
    },
    setMatrix(id, matrix) {
      primary.setMatrix(id, matrix);
      for (const part of secondary) {
        const sid = secondaryId(part, id);
        if (sid !== undefined) part.vat.setMatrix(sid, matrix);
      }
    },
    setTransform(id, transform) {
      primary.setTransform(id, transform);
      const matrix = primary.getMatrix(id);
      for (const part of secondary) {
        const sid = secondaryId(part, id);
        if (sid !== undefined) part.vat.setMatrix(sid, matrix);
      }
    },
    getMatrix: (id, out) => primary.getMatrix(id, out),
    getPosition: (id, out) => primary.getPosition(id, out),
    getPositionOrUndefined: (id, out) => primary.getPositionOrUndefined(id, out),
    getMetadata: (id) => primary.getMetadata(id),
    setMetadata: (id, metadata) => primary.setMetadata(id, metadata),
    trySetMetadata: (id, metadata) => primary.trySetMetadata(id, metadata),
    findByMetadata: (predicate) => primary.findByMetadata(predicate),
    filterByMetadata: (predicate) => primary.filterByMetadata(predicate),
    updateMetadata: (id, updater) => primary.updateMetadata(id, updater),
    tryUpdateMetadata: (id, updater) => primary.tryUpdateMetadata(id, updater),
    deleteMetadata: (id) => primary.deleteMetadata(id),
    play(clip) {
      if (!primary.play(clip)) return false;
      for (const part of secondary) part.vat.play(clip);
      return true;
    },
    update(deltaSeconds) {
      primary.update(deltaSeconds);
      for (const part of secondary) part.vat.update(deltaSeconds);
    },
    setClip(id, clip) {
      if (!primary.setClip(id, clip)) return false;
      for (const part of secondary) {
        const sid = secondaryId(part, id);
        if (sid !== undefined) part.vat.setClip(sid, clip);
      }
      return true;
    },
    setPhaseOffset(id, offset) {
      primary.setPhaseOffset(id, offset);
      for (const part of secondary) {
        const sid = secondaryId(part, id);
        if (sid !== undefined) part.vat.setPhaseOffset(sid, offset);
      }
    },
    setFps(id, fps) {
      primary.setFps(id, fps);
      for (const part of secondary) {
        const sid = secondaryId(part, id);
        if (sid !== undefined) part.vat.setFps(sid, fps);
      }
    },
    setPlayback(id, update) {
      if (!primary.setPlayback(id, update)) return false;
      for (const part of secondary) {
        const sid = secondaryId(part, id);
        if (sid !== undefined) part.vat.setPlayback(sid, update);
      }
      return true;
    },
    setPlaybackMany(items) {
      return api.batchPlayback(() => {
        let accepted = 0;
        for (const { id, ...update } of items) if (api.setPlayback(id, update)) accepted++;
        return accepted;
      });
    },
    batchPlayback(callback) {
      return batchAllPlayback(callback);
    },
    getPlaybackSample: (id, out) => primary.getPlaybackSample(id, out),
    refreshBounds() {
      primary.refreshBounds();
      for (const part of secondary) part.vat.refreshBounds();
    },
    syncInstances() {
      primary.syncInstances();
      for (const part of secondary) part.vat.syncInstances();
    },
    dispose() {
      primary.dispose();
      for (const part of secondary) {
        part.vat.dispose();
        part.secondaryByPrimary.clear();
      }
    }
  };
  return api;
}

/** Find every skinned Babylon.js mesh below a hierarchy root. */
export function findSkinnedMeshes(root: Node): Mesh[] {
  const result: Mesh[] = [];
  const stack: Node[] = [root];
  while (stack.length > 0) {
    const node = stack.pop();
    if (!node) continue;
    if (isSkinnedMesh(node)) result.push(node);
    stack.push(...node.getChildren());
  }
  return result;
}

function isSkinnedMesh(node: Node): node is Mesh {
  return "skeleton" in node && !!(node as Mesh).skeleton;
}
