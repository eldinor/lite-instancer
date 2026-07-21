import {
  bakeVat,
  type AnimationGroup,
  type EngineContext,
  type Mat4,
  type Mesh,
  type VatBakeResult,
  type VatClip,
  type VatHandle
} from "@babylonjs/lite";
import { createInstanceSet, type ColoredInstanceSet } from "./instance-set.js";
import { InstancerError } from "./errors.js";
import { attachVatSafely } from "./vat-attach.js";
import {
  createHostSlotStream,
  type SlotAlignedFloatStreamStats
} from "./slot-aligned-stream.js";
import {
  validateLiteVatAsset,
  type LiteVatAsset,
  type VatAssetAnimatedBounds
} from "./vat-asset.js";
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

/**
 * Minimal animated-instance surface consumed by VAT socket attachments.
 *
 * Both {@link VatInstanceSet} and higher-level coordinated character sets
 * implement this, so attachment synchronization does not depend on how a
 * character's skinned mesh parts are managed.
 */
export interface VatPlaybackSource {
  /** Check whether an animated stable ID exists. */
  has(id: InstanceId): boolean;
  /** Return whether an animated instance is visible. */
  getVisible(id: InstanceId): boolean;
  /** Read an animated instance's current world matrix. */
  getMatrix(id: InstanceId, out?: Mat4): Mat4;
  /** Return the VAT row selection currently used by an instance. */
  getPlaybackSample(id: InstanceId, out?: VatPlaybackSample): VatPlaybackSample | undefined;
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
export interface VatInstanceSet<TMetadata = unknown> extends VatPlaybackSource {
  /** Underlying thin instance set. Use this for transforms, visibility, metadata, colors, and IDs. */
  readonly set: ColoredInstanceSet<TMetadata>;
  /** VAT-backed mesh used by the underlying set. */
  readonly mesh: Mesh;
  /** Babylon Lite VAT handle. Exposed for advanced integrations. */
  readonly handle: VatHandle;
  /** Baked VAT clips keyed by animation group name. */
  readonly clips: Record<string, VatClip>;
  /** Portable source asset when this set was created from an artifact. */
  readonly asset: LiteVatAsset | undefined;
  /** Conservative whole-animation and per-clip bounds supplied by a portable asset. */
  readonly animatedBounds: VatAssetAnimatedBounds | undefined;
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
  /** Allocation, dirty-slot, and flush counters for playback synchronization. */
  readonly playbackStats: Readonly<SlotAlignedFloatStreamStats>;

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
  /** Replace the world matrix for an ID. Throws when the ID is unknown. */
  setMatrix(id: InstanceId, matrix: Mat4): void;
  /** Replace the world matrix, returning false when the ID is unknown. */
  trySetMatrix(id: InstanceId, matrix: Mat4): boolean;
  /** Read the current world matrix. Throws when the ID is unknown. */
  getMatrix(id: InstanceId, out?: Mat4): Mat4;
  /** Read the current world matrix, or return undefined for an unknown ID. */
  getMatrixOrUndefined(id: InstanceId, out?: Mat4): Mat4 | undefined;
  /** Compose and replace a transform. Throws when the ID is unknown. */
  setTransform(id: InstanceId, transform: InstanceTransformInput): void;
  /** Compose and replace a transform, returning false for an unknown ID. */
  trySetTransform(id: InstanceId, transform: InstanceTransformInput): boolean;
  /** Read the current translation. Throws when the ID is unknown. */
  getPosition(id: InstanceId, out?: Float32Array): Float32Array;
  /** Read the current translation, or return undefined for an unknown ID. */
  getPositionOrUndefined(id: InstanceId, out?: Float32Array): Float32Array | undefined;
  /** Replace the translation component. Throws when the ID is unknown. */
  setPosition(id: InstanceId, position: Vec3Like): void;
  /** Replace translation, returning false when the ID is unknown. */
  trySetPosition(id: InstanceId, position: Vec3Like): boolean;
  /** Add a translation delta. Throws when the ID is unknown. */
  translate(id: InstanceId, delta: Vec3Like): void;
  /** Add a translation delta, returning false when the ID is unknown. */
  tryTranslate(id: InstanceId, delta: Vec3Like): boolean;
  /** Replace scale while preserving translation and orientation. */
  setScale(id: InstanceId, scale: Vec3Like | number): void;
  /** Replace scale, returning false when the ID is unknown. */
  trySetScale(id: InstanceId, scale: Vec3Like | number): boolean;
  /** Replace many matrices in one batch. */
  setMatrices(items: Iterable<InstanceMatrixUpdate>): void;
  /** Compose and replace many transforms in one batch. */
  setTransforms(items: Iterable<InstanceTransformUpdate>): void;
  /** Return whether an ID is visible. Throws when the ID is unknown. */
  getVisible(id: InstanceId): boolean;
  /** Return visibility, or undefined when the ID is unknown. */
  getVisibleOrUndefined(id: InstanceId): boolean | undefined;
  /** Hide or show an ID. Throws when the ID is unknown. */
  setVisible(id: InstanceId, visible: boolean): void;
  /** Hide or show an ID, returning false when it is unknown. */
  trySetVisible(id: InstanceId, visible: boolean): boolean;
  /** Hide or show many IDs in one batch. */
  setVisibleMany(ids: Iterable<InstanceId>, visible: boolean): void;
  /** Read app metadata associated with an ID. */
  getMetadata(id: InstanceId): TMetadata | undefined;
  /** Associate app metadata with an ID. */
  setMetadata(id: InstanceId, metadata: TMetadata): void;
  /** Associate metadata, returning false when the ID is unknown. */
  trySetMetadata(id: InstanceId, metadata: TMetadata): boolean;
  /** Find the first ID whose metadata matches a predicate. */
  findByMetadata(predicate: InstanceMetadataPredicate<TMetadata>): InstanceId | undefined;
  /** Return every ID whose metadata matches a predicate. */
  filterByMetadata(predicate: InstanceMetadataPredicate<TMetadata>): InstanceId[];
  /** Update or delete metadata for an ID. */
  updateMetadata(id: InstanceId, updater: InstanceMetadataUpdater<TMetadata>): TMetadata | undefined;
  /** Try to update metadata without throwing for an unknown ID. */
  tryUpdateMetadata(id: InstanceId, updater: InstanceMetadataUpdater<TMetadata>): TMetadata | undefined;
  /** Delete app metadata associated with an ID. */
  deleteMetadata(id: InstanceId): boolean;
  /** Replace the per-instance RGBA color. */
  setColor(id: InstanceId, color: InstanceColorInput): void;
  /** Read the per-instance RGBA color. */
  getColor(id: InstanceId, out?: Float32Array): Float32Array;
  /** Run many safe changes and flush buffers once. */
  batch(callback: (writer: InstanceBatchWriter<TMetadata>) => void): void;
  /** Edit backing arrays directly and mark changed slots for upload. */
  editRaw(callback: (raw: RawInstanceWriter) => void): void;
  /** Ensure at least the requested number of slots is allocated. */
  reserve(capacity: number): void;
  /** Release the instance set and VAT playback handle. */
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
  /** Apply multiple playback edits and upload the resulting dirty slots once. */
  batchPlayback<TResult>(callback: () => TResult): TResult;
  /** Rebuild and upload per-slot VAT playback parameters. */
  syncInstances(): void;
}

interface VatInstancePlayback {
  clip?: string;
  offset: number;
  fps?: number;
}

/** Public Babylon Lite boundary needed to turn portable float data into a VAT texture. */
export interface LiteVatAssetRuntime {
  createBakeResult(engine: EngineContext, asset: LiteVatAsset): VatBakeResult;
}

/** Create a VAT-backed animated instance set for one skinned mesh. */
export function createVatInstanceSet<TMetadata = unknown>(
  engine: EngineContext,
  mesh: Mesh,
  animationGroups: AnimationGroup[],
  options: VatInstanceSetOptions = {}
): VatInstanceSet<TMetadata> {
  const baked = bakeVat(engine, mesh, animationGroups);
  return createVatInstanceSetFromBake(engine, mesh, baked, options);
}

/**
 * Create a VAT instance set from a portable asset. The runtime argument remains explicit until
 * Babylon Lite publishes a raw matrix-VAT texture import API.
 */
export function createVatInstanceSetFromAsset<TMetadata = unknown>(
  engine: EngineContext,
  mesh: Mesh,
  asset: LiteVatAsset,
  options: VatInstanceSetOptions = {},
  runtime?: LiteVatAssetRuntime
): VatInstanceSet<TMetadata> {
  validateLiteVatAsset(asset);
  if (!runtime) {
    throw new InstancerError(
      "Portable VAT loading requires a public Babylon Lite VAT asset runtime; private GPU fields are not used."
    );
  }
  return createVatInstanceSetFromBake(engine, mesh, runtime.createBakeResult(engine, asset), options, asset);
}

function createVatInstanceSetFromBake<TMetadata>(
  engine: EngineContext,
  mesh: Mesh,
  baked: VatBakeResult,
  options: VatInstanceSetOptions,
  sourceAsset?: LiteVatAsset
): VatInstanceSet<TMetadata> {
  const initialClip = options.clip ?? Object.keys(baked.clips)[0];
  const handle = attachVatSafely(engine, mesh, baked, initialClip);
  const { clip: _clip, ...setOptions } = options;
  const set = createInstanceSet<TMetadata>(mesh, {
    ...setOptions,
    gpuCulling: options.gpuCulling ?? false,
    visibleStrategy: options.visibleStrategy ?? "scale-zero"
  });

  let activeClip = initialClip;
  let timeSeconds = 0;
  const playback = new Map<InstanceId, VatInstancePlayback>();
  let playbackSyncDepth = 0;
  let playbackSyncPending = false;

  const playbackStream = createHostSlotStream(set, {
    components: 4,
    backend: {
      bind() {
        // Babylon Lite creates and grows its VAT instance texture from the live-count upload.
      },
      upload(data, count) {
        if (activeClip && count > 0) handle.setInstances(data);
      }
    }
  });
  const playbackValues = new Float32Array(4);

  const writePlaybackSlot = (id: InstanceId): void => {
    const slot = set.getSlot(id);
    if (slot === undefined) return;
    const item = playback.get(id);
    const clip = getClip(handle.clips, item?.clip ?? activeClip);
    if (!clip) {
      playbackValues.fill(0);
    } else {
      const fps = item?.fps ?? clip.fps;
      playbackValues[0] = clip.fromRow;
      playbackValues[1] = clip.fromRow + clip.frameCount - 1;
      playbackValues[2] = (item?.offset ?? getDefaultOffset(slot, set.count, clip)) * fps;
      playbackValues[3] = fps;
    }
    playbackStream.setSlot(slot, playbackValues);
  };

  const rebuildPlaybackSlots = (): void => {
    for (const id of set.ids()) writePlaybackSlot(id);
  };

  const uploadPlaybackInstances = (force = false): void => {
    playbackStream.flush(set.count, force);
  };

  const syncPlaybackInstances = (): void => {
    if (playbackSyncDepth > 0) {
      playbackSyncPending = true;
      return;
    }
    uploadPlaybackInstances();
  };

  const batchPlaybackUpdates = <T>(callback: () => T): T => {
    playbackSyncDepth++;
    try {
      return callback();
    } finally {
      playbackSyncDepth--;
      if (playbackSyncDepth === 0 && playbackSyncPending) {
        playbackSyncPending = false;
        uploadPlaybackInstances();
      }
    }
  };

  const api: VatInstanceSet<TMetadata> = {
    set,
    mesh,
    handle,
    clips: handle.clips,
    get asset() {
      return sourceAsset;
    },
    get animatedBounds() {
      return sourceAsset?.bounds;
    },
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
    get playbackStats() {
      return playbackStream.stats;
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
      writePlaybackSlot(id);
      syncPlaybackInstances();
      return id;
    },
    createMany(items) {
      return batchPlaybackUpdates(() => Array.from(items, (item) => api.create(item)));
    },
    remove(id) {
      const removed = set.remove(id);
      if (removed) {
        playback.delete(id);
        syncPlaybackInstances();
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
        syncPlaybackInstances();
      }
      return removed;
    },
    clear() {
      set.clear();
      playback.clear();
      playbackStream.flush(0, true);
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
      syncPlaybackInstances();
    },
    trySetVisible(id, visible) {
      const updated = set.trySetVisible(id, visible);
      if (updated) {
        syncPlaybackInstances();
      }
      return updated;
    },
    setVisibleMany(ids, visible) {
      set.setVisibleMany(ids, visible);
      syncPlaybackInstances();
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
        syncPlaybackInstances();
      }
    },
    editRaw: (callback) => set.editRaw(callback),
    reserve: (capacity) => set.reserve(capacity),
    dispose() {
      set.dispose();
      playback.clear();
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
      for (const id of set.ids()) {
        if (playback.get(id)?.clip === undefined) writePlaybackSlot(id);
      }
      syncPlaybackInstances();
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
      writePlaybackSlot(id);
      syncPlaybackInstances();
      return true;
    },
    setPhaseOffset(id, offset) {
      if (!set.has(id)) {
        return;
      }
      const current = playback.get(id) ?? { offset: 0 };
      playback.set(id, { ...current, offset });
      writePlaybackSlot(id);
      syncPlaybackInstances();
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
      writePlaybackSlot(id);
      syncPlaybackInstances();
    },
    batchPlayback(callback) {
      return batchPlaybackUpdates(callback);
    },
    syncInstances() {
      rebuildPlaybackSlots();
      if (playbackSyncDepth > 0) {
        playbackSyncPending = true;
      } else {
        uploadPlaybackInstances(true);
      }
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
