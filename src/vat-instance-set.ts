import {
  attachVat,
  bakeVat,
  type AnimationGroup,
  type EngineContext,
  type Mat4,
  type Mesh,
  type VatClip,
  type VatHandle
} from "@babylonjs/lite";
import { createInstanceSet, type ColoredInstanceSet } from "./instance-set.js";
import type {
  InstanceBatchWriter,
  InstanceColorInput,
  InstanceEntry,
  InstanceId,
  InstanceMatrixUpdate,
  InstanceMetadataPredicate,
  InstanceMetadataUpdater,
  InstanceSetOptions,
  InstanceSlotEntry,
  InstanceTransformInput,
  InstanceTransformUpdate,
  RawInstanceWriter,
  Vec3Like
} from "./types.js";

/** Options for a VAT-backed animated instance set. */
export interface VatInstanceSetOptions extends Omit<InstanceSetOptions, "gpuCulling"> {
  /**
   * VAT can move vertices outside authored/rest bounds, so GPU culling defaults to false.
   * Enable only when bounds are known to stay valid.
   */
  gpuCulling?: boolean;
  /** Initial shared VAT clip name. Defaults to the first baked clip. */
  clip?: string;
}

/** Allocation-free description of the VAT row currently used by one instance. */
export interface VatPlaybackSample {
  clip: string;
  timeSeconds: number;
  offsetSeconds: number;
  fps: number;
  frame: number;
  nextFrame: number;
  alpha: number;
}

/** Creation options for one VAT-backed instance. */
export interface VatInstanceCreateOptions<TMetadata = unknown> {
  /** Initial instance transform. */
  transform?: InstanceTransformInput;
  /** App metadata associated with the returned ID. */
  metadata?: TMetadata;
  /** Optional per-instance clip override. */
  clip?: string;
  /** Per-instance playback offset in seconds. */
  offset?: number;
  /** Per-instance playback rate in frames per second. */
  fps?: number;
}

/**
 * VAT-backed animated instance helper for one skinned mesh.
 *
 * The helper bakes Babylon Lite animation groups, attaches VAT playback to `mesh`, and exposes an
 * underlying `ColoredInstanceSet` for transforms, metadata, visibility, colors, and picking.
 */
export interface VatInstanceSet<TMetadata = unknown> {
  /** Underlying thin instance set. Use this for transforms, visibility, metadata, colors, and IDs. */
  readonly set: ColoredInstanceSet<TMetadata>;
  /** VAT-backed mesh used by the underlying set. */
  readonly mesh: Mesh;
  /** Babylon Lite VAT handle. Exposed for advanced integrations. */
  readonly handle: VatHandle;
  /** Baked VAT clips keyed by animation group name. */
  readonly clips: Record<string, VatClip>;
  /** Shared default clip used by instances without a per-instance clip override. */
  readonly activeClip: string | undefined;
  /** Elapsed VAT playback time in seconds. */
  readonly timeSeconds: number;
  /** Number of live animated IDs, visible or hidden. */
  readonly count: number;
  /** Allocated instance capacity. */
  readonly capacity: number;
  /** Number of currently visible animated IDs. */
  readonly visibleCount: number;

  /** Create an animated instance and return its stable ID. */
  create(options?: VatInstanceCreateOptions<TMetadata>): InstanceId;
  /** Create many animated instances and return IDs in input order. */
  createMany(items: Iterable<VatInstanceCreateOptions<TMetadata>>): InstanceId[];
  /** Remove an animated instance. */
  remove(id: InstanceId): boolean;
  /** Remove many animated instances. Returns the number actually removed. */
  removeMany(ids: Iterable<InstanceId>): number;
  /** Remove every animated instance. */
  clear(): void;
  /** Check whether an animated ID still exists. */
  has(id: InstanceId): boolean;
  /** Get the current backing slot for an ID. */
  getSlot(id: InstanceId): number | undefined;
  /** Get the ID currently occupying a backing slot. */
  getIdForSlot(slot: number): InstanceId | undefined;
  /** Iterate all live IDs in current slot order. */
  ids(): IterableIterator<InstanceId>;
  /** Iterate visible live IDs in current slot order. */
  visibleIds(): IterableIterator<InstanceId>;
  /** Iterate all live ID/slot pairs in current slot order. */
  slots(): IterableIterator<InstanceSlotEntry>;
  /** Iterate all live IDs with slots and metadata in current slot order. */
  entries(): IterableIterator<InstanceEntry<TMetadata>>;
  /** Run a callback for every live ID in current slot order. */
  forEach(callback: (id: InstanceId, slot: number) => void): void;
  setMatrix(id: InstanceId, matrix: Mat4): void;
  trySetMatrix(id: InstanceId, matrix: Mat4): boolean;
  getMatrix(id: InstanceId, out?: Mat4): Mat4;
  getMatrixOrUndefined(id: InstanceId, out?: Mat4): Mat4 | undefined;
  setTransform(id: InstanceId, transform: InstanceTransformInput): void;
  trySetTransform(id: InstanceId, transform: InstanceTransformInput): boolean;
  getPosition(id: InstanceId, out?: Float32Array): Float32Array;
  getPositionOrUndefined(id: InstanceId, out?: Float32Array): Float32Array | undefined;
  setPosition(id: InstanceId, position: Vec3Like): void;
  trySetPosition(id: InstanceId, position: Vec3Like): boolean;
  translate(id: InstanceId, delta: Vec3Like): void;
  tryTranslate(id: InstanceId, delta: Vec3Like): boolean;
  setScale(id: InstanceId, scale: Vec3Like | number): void;
  trySetScale(id: InstanceId, scale: Vec3Like | number): boolean;
  setMatrices(items: Iterable<InstanceMatrixUpdate>): void;
  setTransforms(items: Iterable<InstanceTransformUpdate>): void;
  getVisible(id: InstanceId): boolean;
  getVisibleOrUndefined(id: InstanceId): boolean | undefined;
  setVisible(id: InstanceId, visible: boolean): void;
  trySetVisible(id: InstanceId, visible: boolean): boolean;
  setVisibleMany(ids: Iterable<InstanceId>, visible: boolean): void;
  getMetadata(id: InstanceId): TMetadata | undefined;
  setMetadata(id: InstanceId, metadata: TMetadata): void;
  trySetMetadata(id: InstanceId, metadata: TMetadata): boolean;
  findByMetadata(predicate: InstanceMetadataPredicate<TMetadata>): InstanceId | undefined;
  filterByMetadata(predicate: InstanceMetadataPredicate<TMetadata>): InstanceId[];
  updateMetadata(id: InstanceId, updater: InstanceMetadataUpdater<TMetadata>): TMetadata | undefined;
  tryUpdateMetadata(id: InstanceId, updater: InstanceMetadataUpdater<TMetadata>): TMetadata | undefined;
  deleteMetadata(id: InstanceId): boolean;
  setColor(id: InstanceId, color: InstanceColorInput): void;
  getColor(id: InstanceId, out?: Float32Array): Float32Array;
  batch(callback: (writer: InstanceBatchWriter<TMetadata>) => void): void;
  editRaw(callback: (raw: RawInstanceWriter) => void): void;
  reserve(capacity: number): void;
  dispose(): void;
  /** Return the shared default clip data. */
  getActiveClip(): VatClip | undefined;
  /** Return an instance's effective clip name, including the shared default fallback. */
  getClip(id: InstanceId): string | undefined;
  /** Return the VAT row selection currently used by an instance. */
  getPlaybackSample(id: InstanceId, out?: VatPlaybackSample): VatPlaybackSample | undefined;
  /** Change the shared default clip for instances that do not override it. */
  play(clip: string): boolean;
  /** Advance VAT playback. Call once per frame. */
  update(deltaSeconds: number): void;
  /** Set or clear a per-instance clip override. */
  setClip(id: InstanceId, clip: string | undefined): boolean;
  /** Set a per-instance playback offset in seconds. */
  setPhaseOffset(id: InstanceId, offset: number): void;
  /** Set or clear a per-instance playback fps override. */
  setFps(id: InstanceId, fps: number | undefined): void;
  /** Rebuild and upload per-slot VAT playback parameters. */
  syncInstances(): void;
}

interface VatInstancePlayback {
  clip?: string;
  offset: number;
  fps?: number;
}

/** Create a VAT-backed animated instance set for one skinned mesh. */
export function createVatInstanceSet<TMetadata = unknown>(
  engine: EngineContext,
  mesh: Mesh,
  animationGroups: AnimationGroup[],
  options: VatInstanceSetOptions = {}
): VatInstanceSet<TMetadata> {
  const baked = bakeVat(engine, mesh, animationGroups);
  const initialClip = options.clip ?? Object.keys(baked.clips)[0];
  const handle = attachVat(engine, mesh, baked, initialClip);
  const { clip: _clip, ...setOptions } = options;
  const set = createInstanceSet<TMetadata>(mesh, {
    ...setOptions,
    gpuCulling: options.gpuCulling ?? false,
    visibleStrategy: options.visibleStrategy ?? "scale-zero"
  });

  let activeClip = initialClip;
  let timeSeconds = 0;
  const playback = new Map<InstanceId, VatInstancePlayback>();

  const api: VatInstanceSet<TMetadata> = {
    set,
    mesh,
    handle,
    clips: handle.clips,
    get activeClip() {
      return activeClip;
    },
    get timeSeconds() {
      return timeSeconds;
    },
    get count() {
      return set.count;
    },
    get capacity() {
      return set.capacity;
    },
    get visibleCount() {
      return set.visibleCount;
    },
    create(createOptions = {}) {
      const id = set.create(createOptions.transform, createOptions.metadata);
      const clipName = createOptions.clip && handle.clips[createOptions.clip] ? createOptions.clip : undefined;
      const clip = getClip(handle.clips, clipName ?? activeClip);
      playback.set(
        id,
        createPlayback({
          clip: clipName,
          offset: createOptions.offset ?? getDefaultOffset(set.count - 1, set.count, clip),
          fps: createOptions.fps
        })
      );
      api.syncInstances();
      return id;
    },
    createMany(items) {
      const ids: InstanceId[] = [];
      for (const item of items) {
        ids.push(api.create(item));
      }
      return ids;
    },
    remove(id) {
      const removed = set.remove(id);
      if (removed) {
        playback.delete(id);
        api.syncInstances();
      }
      return removed;
    },
    removeMany(ids) {
      let removed = 0;
      for (const id of ids) {
        if (set.remove(id)) {
          playback.delete(id);
          removed++;
        }
      }
      if (removed > 0) {
        api.syncInstances();
      }
      return removed;
    },
    clear() {
      set.clear();
      playback.clear();
      api.syncInstances();
    },
    has: (id) => set.has(id),
    getSlot: (id) => set.getSlot(id),
    getIdForSlot: (slot) => set.getIdForSlot(slot),
    ids: () => set.ids(),
    visibleIds: () => set.visibleIds(),
    slots: () => set.slots(),
    entries: () => set.entries(),
    forEach: (callback) => set.forEach(callback),
    setMatrix: (id, matrix) => set.setMatrix(id, matrix),
    trySetMatrix: (id, matrix) => set.trySetMatrix(id, matrix),
    getMatrix: (id, out) => set.getMatrix(id, out),
    getMatrixOrUndefined: (id, out) => set.getMatrixOrUndefined(id, out),
    setTransform: (id, transform) => set.setTransform(id, transform),
    trySetTransform: (id, transform) => set.trySetTransform(id, transform),
    getPosition: (id, out) => set.getPosition(id, out),
    getPositionOrUndefined: (id, out) => set.getPositionOrUndefined(id, out),
    setPosition: (id, position) => set.setPosition(id, position),
    trySetPosition: (id, position) => set.trySetPosition(id, position),
    translate: (id, delta) => set.translate(id, delta),
    tryTranslate: (id, delta) => set.tryTranslate(id, delta),
    setScale: (id, scale) => set.setScale(id, scale),
    trySetScale: (id, scale) => set.trySetScale(id, scale),
    setMatrices: (items) => set.setMatrices(items),
    setTransforms: (items) => set.setTransforms(items),
    getVisible: (id) => set.getVisible(id),
    getVisibleOrUndefined: (id) => set.getVisibleOrUndefined(id),
    setVisible(id, visible) {
      set.setVisible(id, visible);
      api.syncInstances();
    },
    trySetVisible(id, visible) {
      const updated = set.trySetVisible(id, visible);
      if (updated) {
        api.syncInstances();
      }
      return updated;
    },
    setVisibleMany(ids, visible) {
      set.setVisibleMany(ids, visible);
      api.syncInstances();
    },
    getMetadata: (id) => set.getMetadata(id),
    setMetadata: (id, metadata) => set.setMetadata(id, metadata),
    trySetMetadata: (id, metadata) => set.trySetMetadata(id, metadata),
    findByMetadata: (predicate) => set.findByMetadata(predicate),
    filterByMetadata: (predicate) => set.filterByMetadata(predicate),
    updateMetadata: (id, updater) => set.updateMetadata(id, updater),
    tryUpdateMetadata: (id, updater) => set.tryUpdateMetadata(id, updater),
    deleteMetadata: (id) => set.deleteMetadata(id),
    setColor: (id, color) => set.setColor(id, color),
    getColor: (id, out) => set.getColor(id, out),
    batch(callback) {
      let needsPlaybackSync = false;
      set.batch((writer) => {
        callback({
          ...writer,
          setVisible(id, visible) {
            writer.setVisible(id, visible);
            needsPlaybackSync = true;
          }
        });
      });
      if (needsPlaybackSync) {
        api.syncInstances();
      }
    },
    editRaw: (callback) => set.editRaw(callback),
    reserve: (capacity) => set.reserve(capacity),
    dispose() {
      set.dispose();
      playback.clear();
      api.syncInstances();
    },
    getActiveClip() {
      return activeClip ? handle.clips[activeClip] : undefined;
    },
    getClip(id) {
      if (!set.has(id)) {
        return undefined;
      }
      return playback.get(id)?.clip ?? activeClip;
    },
    getPlaybackSample(id, out) {
      if (!set.has(id)) {
        return undefined;
      }
      const item = playback.get(id);
      const name = item?.clip ?? activeClip;
      const clip = getClip(handle.clips, name);
      if (!clip || !name) {
        return undefined;
      }
      return writePlaybackSample(
        out ?? { clip: name, timeSeconds: 0, offsetSeconds: 0, fps: 0, frame: 0, nextFrame: 0, alpha: 0 },
        name,
        clip,
        timeSeconds,
        item?.offset ?? 0,
        item?.fps ?? clip.fps
      );
    },
    play(clip) {
      if (!handle.clips[clip]) {
        return false;
      }
      activeClip = clip;
      handle.play(clip);
      api.syncInstances();
      return true;
    },
    update(deltaSeconds) {
      timeSeconds += deltaSeconds;
      handle.update(deltaSeconds);
    },
    setClip(id, clip) {
      if (!set.has(id) || (clip !== undefined && !handle.clips[clip])) {
        return false;
      }
      const current = playback.get(id) ?? { offset: 0 };
      playback.set(
        id,
        createPlayback({
          clip,
          offset: current.offset,
          fps: current.fps
        })
      );
      api.syncInstances();
      return true;
    },
    setPhaseOffset(id, offset) {
      if (!set.has(id)) {
        return;
      }
      const current = playback.get(id) ?? { offset: 0 };
      playback.set(id, { ...current, offset });
      api.syncInstances();
    },
    setFps(id, fps) {
      if (!set.has(id)) {
        return;
      }
      const current = playback.get(id) ?? { offset: 0 };
      playback.set(
        id,
        createPlayback({
          clip: current.clip,
          offset: current.offset,
          fps
        })
      );
      api.syncInstances();
    },
    syncInstances() {
      if (!api.getActiveClip() || set.count === 0) {
        return;
      }
      const params = new Float32Array(set.count * 4);
      for (let slot = 0; slot < set.count; slot++) {
        const id = set.getIdForSlot(slot);
        const item = id === undefined ? undefined : playback.get(id);
        const clip = getClip(handle.clips, item?.clip ?? activeClip);
        if (!clip) {
          continue;
        }
        params[slot * 4] = clip.fromRow;
        params[slot * 4 + 1] = clip.fromRow + clip.frameCount - 1;
        const fps = item?.fps ?? clip.fps;
        params[slot * 4 + 2] = (item?.offset ?? getDefaultOffset(slot, set.count, clip)) * fps;
        params[slot * 4 + 3] = fps;
      }
      handle.setInstances(params);
    }
  };

  return api;
}

function getDefaultOffset(slot: number, count: number, clip: VatClip | undefined): number {
  if (!clip || count <= 0) {
    return 0;
  }
  return (slot / count) * (clip.frameCount / clip.fps);
}

function getClip(clips: Record<string, VatClip>, name: string | undefined): VatClip | undefined {
  return name ? clips[name] : undefined;
}

function createPlayback(options: { clip: string | undefined; offset: number; fps: number | undefined }): VatInstancePlayback {
  const playback: VatInstancePlayback = { offset: options.offset };
  if (options.clip !== undefined) {
    playback.clip = options.clip;
  }
  if (options.fps !== undefined) {
    playback.fps = options.fps;
  }
  return playback;
}

function writePlaybackSample(
  out: VatPlaybackSample,
  clipName: string,
  clip: VatClip,
  timeSeconds: number,
  offsetSeconds: number,
  fps: number
): VatPlaybackSample {
  const span = Math.max(1, clip.frameCount);
  const raw = (offsetSeconds + timeSeconds) * fps;
  const wrapped = raw - Math.floor(raw / span) * span;
  const frame = Math.floor(wrapped);
  out.clip = clipName;
  out.timeSeconds = timeSeconds;
  out.offsetSeconds = offsetSeconds;
  out.fps = fps;
  out.frame = frame;
  out.nextFrame = (frame + 1) % span;
  out.alpha = wrapped - frame;
  return out;
}
