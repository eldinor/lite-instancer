import type { AbstractEngine } from "@babylonjs/core/Engines/abstractEngine.js";

/** Column-major matrix storage used by the instance-set API. */
export type Mat4 = Float32Array;

/**
 * Stable numeric handle for an app-level instance.
 *
 * Slots inside Babylon Lite buffers may move after removal, visibility changes, or growth.
 * Keep `InstanceId` values in app state and call `getSlot(id)` only when you need the current
 * low-level slot.
 */
export type InstanceId = number & { readonly __brand: unique symbol };

export type Vec3Like = readonly [number, number, number] | Float32Array | Float64Array;
export type QuatLike = readonly [number, number, number, number] | Float32Array | Float64Array;
export type InstanceColorInput = readonly [number, number, number, number] | Float32Array | Float64Array;

/** Matrix input or a small transform object accepted by instance creation/update APIs. */
export type InstanceTransformInput =
  | Mat4
  | {
      position?: Vec3Like;
      rotationQuaternion?: QuatLike;
      rotationEuler?: Vec3Like;
      scale?: Vec3Like | number;
    };

export type GrowStrategy = "none" | "double" | "exact";
export type HierarchyGrowStrategy = "none" | "rebuild";

/**
 * How hidden instances are represented in Babylon Lite buffers.
 *
 * - `"active-count"` packs visible instances at the start of the buffer and changes slots.
 * - `"scale-zero"` keeps instances in the drawn range and writes zero-scale matrices for hidden IDs.
 */
export type VisibilityStrategy = "active-count" | "scale-zero";

/** Aggregate thin-instance bounds maintenance policy. */
export type InstanceBoundsMode = "auto" | "manual" | "fixed";

/** Conservative mesh-local aggregate AABB covering every rendered instance. */
export interface InstanceBounds {
  readonly minimum: Vec3Like;
  readonly maximum: Vec3Like;
}

/** Input for creating one instance through bulk helpers. */
export interface InstanceCreateInput<TMetadata = unknown> {
  transform?: InstanceTransformInput;
  metadata?: TMetadata;
}

/** Current stable ID and backing slot pair. */
export interface InstanceSlotEntry {
  id: InstanceId;
  slot: number;
}

/** Current stable ID, backing slot, and optional app metadata. */
export interface InstanceEntry<TMetadata = unknown> extends InstanceSlotEntry {
  metadata?: TMetadata;
}

/** Matrix update item accepted by bulk helpers. */
export interface InstanceMatrixUpdate {
  id: InstanceId;
  matrix: Mat4;
}

/** Transform update item accepted by bulk helpers. */
export interface InstanceTransformUpdate {
  id: InstanceId;
  transform: InstanceTransformInput;
}

/** Metadata predicate used by query helpers. */
export type InstanceMetadataPredicate<TMetadata = unknown> = (
  metadata: TMetadata,
  id: InstanceId,
  slot: number
) => boolean;

/** Metadata updater. Return `undefined` to delete metadata for the ID. */
export type InstanceMetadataUpdater<TMetadata = unknown> = (
  current: TMetadata | undefined,
  id: InstanceId
) => TMetadata | undefined;

/** Options shared by single-mesh thin instance sets. */
export interface InstanceSetOptions {
  /** Initial number of instance slots to allocate. Defaults to 128. */
  capacity?: number;
  /** Growth behavior when `create` exceeds capacity. Defaults to `"double"`. */
  grow?: GrowStrategy;
  /** Babylon Lite engine context used to invalidate render bundles after buffer changes. */
  engine?: AbstractEngine;
  /** Reserved for API compatibility. Babylon.js currently has no equivalent opt-in switch. */
  gpuCulling?: boolean;
  /** Allocate and upload a per-instance color buffer. Created lazily if omitted and `setColor` is used. */
  colors?: boolean;
  /** Visibility implementation. Defaults to `"active-count"`. */
  visibleStrategy?: VisibilityStrategy;
  /** Bounds maintenance. `"auto"` preserves Babylon.js-compatible refresh behavior. */
  boundsMode?: InstanceBoundsMode;
  /** Required conservative aggregate AABB when `boundsMode` is `"fixed"`. */
  fixedBounds?: InstanceBounds;
}

/** Options for GLB/hierarchy instance pools. */
export interface HierarchyInstanceSetOptions {
  /** Initial number of hierarchy instance slots. Defaults to 128. */
  capacity?: number;
  /** Hierarchy pools can either stay fixed or rebuild at a larger capacity. Defaults to `"none"`. */
  grow?: HierarchyGrowStrategy;
  /** Babylon Lite engine context used to invalidate render bundles after pool changes. */
  engine?: AbstractEngine;
  /** Enable thin instance GPU culling on meshes inside the hierarchy pool. */
  gpuCulling?: boolean;
  /** Visibility implementation. Defaults to `"active-count"`. */
  visibleStrategy?: VisibilityStrategy;
  /** Bounds maintenance. `"auto"` preserves Babylon.js-compatible refresh behavior. */
  boundsMode?: InstanceBoundsMode;
  /** Common conservative mesh-local aggregate AABB applied to every hierarchy mesh in fixed mode. */
  fixedBounds?: InstanceBounds;
}

/** Safe writer passed to `batch` so many app updates flush together. */
export interface InstanceBatchWriter<TMetadata = unknown> {
  /** Replace an instance matrix. */
  setMatrix(id: InstanceId, matrix: Mat4): void;
  /** Compose and replace an instance transform. */
  setTransform(id: InstanceId, transform: InstanceTransformInput): void;
  /** Replace an instance translation. */
  setPosition(id: InstanceId, position: Vec3Like): void;
  /** Add a translation delta to an instance. */
  translate(id: InstanceId, delta: Vec3Like): void;
  /** Replace instance scale while preserving translation and orientation. */
  setScale(id: InstanceId, scale: Vec3Like | number): void;
  /** Change instance visibility. */
  setVisible(id: InstanceId, visible: boolean): void;
  /** Associate app metadata with an instance. */
  setMetadata(id: InstanceId, metadata: TMetadata): void;
  /** Replace instance color when the set supports colors. */
  setColor?(id: InstanceId, color: InstanceColorInput): void;
}

/** Direct buffer writer for advanced high-throughput updates. */
export interface RawInstanceWriter {
  /** Matrix buffer in slot order, 16 numbers per instance. */
  readonly matrices: Float32Array | Float64Array;
  /** Optional color buffer in slot order, 4 numbers per instance. */
  readonly colors?: Float32Array;
  /** Return the current slot for an ID, if the ID still exists. */
  getSlot(id: InstanceId): number | undefined;
  /** Copy a matrix into the slot currently occupied by an ID. */
  writeMatrix(id: InstanceId, matrix: Mat4): void;
  /** Copy a color into the slot currently occupied by an ID. */
  writeColor(id: InstanceId, color: InstanceColorInput): void;
  /** Mark one matrix slot for upload after direct buffer edits. */
  markMatrixDirty(slot: number): void;
  /** Mark one color slot for upload after direct buffer edits. */
  markColorDirty(slot: number): void;
}

/** Shared app-level API implemented by single-mesh and hierarchy instance sets. */
export interface BaseInstanceSet<TMetadata = unknown> {
  /** Number of live IDs, visible or hidden. */
  readonly count: number;
  /** Allocated slot count. */
  readonly capacity: number;
  /** Number of currently visible IDs. */
  readonly visibleCount: number;

  /** Create an instance and return its stable ID. */
  create(transform?: InstanceTransformInput, metadata?: TMetadata): InstanceId;
  /** Create many instances and return their stable IDs in input order. */
  createMany(items: Iterable<InstanceCreateInput<TMetadata>>): InstanceId[];
  /** Remove an ID. Returns false when the ID is unknown. */
  remove(id: InstanceId): boolean;
  /** Remove many IDs. Returns the number of IDs actually removed. */
  removeMany(ids: Iterable<InstanceId>): number;
  /** Remove every instance while keeping allocated buffers. */
  clear(): void;

  /** Check whether an ID still exists. */
  has(id: InstanceId): boolean;
  /** Get the current backing slot for an ID. Slots are not stable over time. */
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
  /** Replace the world matrix for an ID. Returns false when the ID is unknown. */
  trySetMatrix(id: InstanceId, matrix: Mat4): boolean;
  /** Read the current world matrix for an ID. Throws when the ID is unknown. */
  getMatrix(id: InstanceId, out?: Mat4): Mat4;
  /** Read the current world matrix for an ID. Returns undefined when the ID is unknown. */
  getMatrixOrUndefined(id: InstanceId, out?: Mat4): Mat4 | undefined;
  /** Compose and write a transform object or matrix. Throws when the ID is unknown. */
  setTransform(id: InstanceId, transform: InstanceTransformInput): void;
  /** Compose and write a transform object or matrix. Returns false when the ID is unknown. */
  trySetTransform(id: InstanceId, transform: InstanceTransformInput): boolean;
  /** Read the translation component of the current matrix. Throws when the ID is unknown. */
  getPosition(id: InstanceId, out?: Float32Array): Float32Array;
  /** Read the translation component of the current matrix. Returns undefined when the ID is unknown. */
  getPositionOrUndefined(id: InstanceId, out?: Float32Array): Float32Array | undefined;
  /** Replace only the translation component of the current matrix. Throws when the ID is unknown. */
  setPosition(id: InstanceId, position: Vec3Like): void;
  /** Replace only the translation component of the current matrix. Returns false when the ID is unknown. */
  trySetPosition(id: InstanceId, position: Vec3Like): boolean;
  /** Add a delta to the translation component of the current matrix. Throws when the ID is unknown. */
  translate(id: InstanceId, delta: Vec3Like): void;
  /** Add a delta to the translation component of the current matrix. Returns false when the ID is unknown. */
  tryTranslate(id: InstanceId, delta: Vec3Like): boolean;
  /** Replace matrix scale while preserving current translation and basis orientation. Throws when the ID is unknown. */
  setScale(id: InstanceId, scale: Vec3Like | number): void;
  /** Replace matrix scale while preserving current translation and basis orientation. Returns false when the ID is unknown. */
  trySetScale(id: InstanceId, scale: Vec3Like | number): boolean;
  /** Set many matrices in one batch. */
  setMatrices(items: Iterable<InstanceMatrixUpdate>): void;
  /** Set many transforms in one batch. */
  setTransforms(items: Iterable<InstanceTransformUpdate>): void;
  /** Return whether an ID is visible. Throws when the ID is unknown. */
  getVisible(id: InstanceId): boolean;
  /** Return whether an ID is visible. Returns undefined when the ID is unknown. */
  getVisibleOrUndefined(id: InstanceId): boolean | undefined;
  /** Hide or show an ID using the configured visibility strategy. Throws when the ID is unknown. */
  setVisible(id: InstanceId, visible: boolean): void;
  /** Hide or show an ID using the configured visibility strategy. Returns false when the ID is unknown. */
  trySetVisible(id: InstanceId, visible: boolean): boolean;
  /** Hide or show many IDs in one batch. */
  setVisibleMany(ids: Iterable<InstanceId>, visible: boolean): void;

  /** Read app metadata associated with an ID. */
  getMetadata(id: InstanceId): TMetadata | undefined;
  /** Set app metadata associated with an ID. Throws when the ID is unknown. */
  setMetadata(id: InstanceId, metadata: TMetadata): void;
  /** Set app metadata associated with an ID. Returns false when the ID is unknown. */
  trySetMetadata(id: InstanceId, metadata: TMetadata): boolean;
  /** Find the first ID whose metadata matches. IDs without metadata are skipped. */
  findByMetadata(predicate: InstanceMetadataPredicate<TMetadata>): InstanceId | undefined;
  /** Return all IDs whose metadata matches. IDs without metadata are skipped. */
  filterByMetadata(predicate: InstanceMetadataPredicate<TMetadata>): InstanceId[];
  /** Update or delete metadata for an ID. Throws when the ID is unknown. */
  updateMetadata(id: InstanceId, updater: InstanceMetadataUpdater<TMetadata>): TMetadata | undefined;
  /** Update or delete metadata for an ID. Returns undefined when the ID is unknown or metadata was deleted. */
  tryUpdateMetadata(id: InstanceId, updater: InstanceMetadataUpdater<TMetadata>): TMetadata | undefined;
  /** Delete app metadata for an ID. */
  deleteMetadata(id: InstanceId): boolean;

  /** Run many safe updates and flush once. */
  batch(callback: (writer: InstanceBatchWriter<TMetadata>) => void): void;
  /** Edit backing arrays directly for hot paths. Mark dirty slots after raw writes. */
  editRaw(callback: (raw: RawInstanceWriter) => void): void;

  /** Ensure at least this many slots are allocated. */
  reserve(capacity: number): void;
  /** Refresh aggregate bounds now, or reapply configured fixed bounds. */
  refreshBounds(): void;
  /** Clear the set and detach thin instance data from backing objects. */
  dispose(): void;
}

/** Cast a trusted numeric value into an `InstanceId`. Mainly useful when restoring serialized state. */
export function toInstanceId(value: number): InstanceId {
  return value as InstanceId;
}
