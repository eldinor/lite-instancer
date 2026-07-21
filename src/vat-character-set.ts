import {
  bakeVat,
  type AnimationGroup,
  type EngineContext,
  type Mat4,
  type Mesh,
  type SceneNode,
  type VatClip,
  type VatHandle
} from "@babylonjs/lite";
import { createInstanceSet, type ColoredInstanceSet } from "./instance-set.js";
import type { InstanceId, InstanceTransformInput } from "./types.js";
import { attachVatSafely } from "./vat-attach.js";
import {
  createHostSlotStream,
  type SlotAlignedFloatStream,
  type SlotAlignedFloatStreamStats
} from "./slot-aligned-stream.js";
import {
  createVatInstanceSet,
  type VatInstanceCreateOptions,
  type VatInstanceSet,
  type VatInstanceSetOptions,
  type VatPlaybackSample,
  type VatPlaybackSource
} from "./vat-instance-set.js";

/** Options for a coordinated VAT character with one or more skinned mesh parts. */
export interface VatCharacterSetOptions extends VatInstanceSetOptions {}

/** Read-only description of one additional skinned mesh managed by a character set. */
export interface VatCharacterMeshPart {
  readonly mesh: Mesh;
  readonly playbackStats: Readonly<SlotAlignedFloatStreamStats>;
}

/**
 * One logical animated character backed by every skinned mesh beneath a GLB root.
 *
 * All parts receive matching stable IDs, transforms, visibility, clip selection,
 * phase offsets, and FPS overrides. It implements {@link VatPlaybackSource}, so it
 * can be passed directly to `createVatAttachmentController()`.
 */
export interface VatCharacterSet<TMetadata = unknown> extends VatPlaybackSource {
  readonly root: SceneNode;
  /** The first skinned mesh's VAT set, exposed for advanced read-only inspection. */
  readonly primary: VatInstanceSet<TMetadata>;
  /** Additional skinned meshes automatically synchronized with `primary`. */
  readonly secondaryParts: readonly VatCharacterMeshPart[];
  readonly clips: Record<string, VatClip>;
  readonly activeClip: string | undefined;
  readonly timeSeconds: number;
  readonly count: number;
  readonly capacity: number;
  readonly visibleCount: number;

  /** Create one synchronized character instance across every mesh part. */
  create(options?: VatInstanceCreateOptions<TMetadata>): InstanceId;
  /** Create many synchronized character instances and return their primary stable IDs. */
  createMany(items: Iterable<VatInstanceCreateOptions<TMetadata>>): InstanceId[];
  /** Remove a synchronized character instance. */
  remove(id: InstanceId): boolean;
  /** Remove every synchronized character instance. */
  clear(): void;
  /** Check whether a primary character ID exists. */
  has(id: InstanceId): boolean;
  /** Return whether a character instance is visible. */
  getVisible(id: InstanceId): boolean;
  /** Change visibility across every mesh part. */
  setVisible(id: InstanceId, visible: boolean): void;
  /** Replace the world matrix across every mesh part. */
  setMatrix(id: InstanceId, matrix: Mat4): void;
  /** Compose and replace a transform across every mesh part. */
  setTransform(id: InstanceId, transform: InstanceTransformInput): void;
  /** Read the primary mesh part's current world matrix. */
  getMatrix(id: InstanceId, out?: Mat4): Mat4;
  /** Change the shared default clip across every mesh part. */
  play(clip: string): boolean;
  /** Advance VAT playback across every mesh part. Call once per frame. */
  update(deltaSeconds: number): void;
  /** Set or clear a character instance's clip override across every mesh part. */
  setClip(id: InstanceId, clip: string | undefined): boolean;
  /** Set a character instance's playback offset in seconds. */
  setPhaseOffset(id: InstanceId, offset: number): void;
  /** Set or clear a character instance's FPS override. */
  setFps(id: InstanceId, fps: number | undefined): void;
  /** Apply multiple coordinated playback edits and upload each mesh stream once. */
  batchPlayback<TResult>(callback: () => TResult): TResult;
  /** Return the VAT row selection currently used by a character instance. */
  getPlaybackSample(id: InstanceId, out?: VatPlaybackSample): VatPlaybackSample | undefined;
  /** Re-upload synchronized secondary playback parameters after advanced primary-set changes. */
  syncInstances(): void;
  /** Release VAT handles and all coordinated instance sets. */
  dispose(): void;
}

interface SecondaryPart {
  readonly mesh: Mesh;
  readonly handle: VatHandle;
  readonly set: ColoredInstanceSet;
  readonly playbackStream: SlotAlignedFloatStream;
  readonly primaryBySecondary: Map<InstanceId, InstanceId>;
  readonly secondaryByPrimary: Map<InstanceId, InstanceId>;
}

/** Create a coordinated VAT character set from every skinned mesh in a GLB hierarchy. */
export function createVatCharacterSet<TMetadata = unknown>(
  engine: EngineContext,
  root: SceneNode,
  animationGroups: AnimationGroup[],
  options: VatCharacterSetOptions = {}
): VatCharacterSet<TMetadata> {
  const skinnedMeshes = findSkinnedMeshes(root);
  const primaryMesh = skinnedMeshes.shift();
  if (!primaryMesh) {
    throw new Error("VAT character requires at least one skinned mesh.");
  }
  if (animationGroups.length === 0) {
    throw new Error("VAT character requires at least one animation group.");
  }

  const primary = createVatInstanceSet<TMetadata>(engine, primaryMesh, animationGroups, options);
  const { clip: _clip, ...instanceOptions } = options;
  const secondary = skinnedMeshes.map<SecondaryPart>((mesh) => {
    const handle = attachVatSafely(engine, mesh, bakeVat(engine, mesh, animationGroups));
    const set = createInstanceSet(mesh, {
      ...instanceOptions,
      gpuCulling: options.gpuCulling ?? false,
      visibleStrategy: options.visibleStrategy ?? "scale-zero"
    });
    const playbackStream = createHostSlotStream(set, {
      components: 4,
      backend: {
        bind() {},
        upload(data, count) {
          if (count > 0) handle.setInstances(data);
        }
      }
    });
    return { mesh, handle, set, playbackStream, primaryBySecondary: new Map(), secondaryByPrimary: new Map() };
  });

  for (const part of secondary) {
    for (const clipName of Object.keys(primary.clips)) {
      if (!part.handle.clips[clipName]) {
        throw new Error(`VAT character mesh part is missing baked clip \"${clipName}\".`);
      }
    }
  }

  const secondaryValues = new Float32Array(4);
  const writeSecondaryPlayback = (part: SecondaryPart, primaryId: InstanceId): void => {
    const secondaryId = part.secondaryByPrimary.get(primaryId);
    const slot = secondaryId === undefined ? undefined : part.set.getSlot(secondaryId);
    const sample = primary.getPlaybackSample(primaryId);
    const clip = sample ? part.handle.clips[sample.clip] : undefined;
    if (slot === undefined) return;
    if (!sample || !clip) {
      secondaryValues.fill(0);
    } else {
      secondaryValues[0] = clip.fromRow;
      secondaryValues[1] = clip.fromRow + clip.frameCount - 1;
      secondaryValues[2] = sample.offsetSeconds * sample.fps;
      secondaryValues[3] = sample.fps;
    }
    part.playbackStream.setSlot(slot, secondaryValues);
  };

  const synchronizeSecondaryPlayback = (
    ids?: Iterable<InstanceId>,
    force = false,
    syncSharedClip = false
  ): void => {
    const activeClip = primary.activeClip;
    for (const part of secondary) {
      if (syncSharedClip && activeClip && part.handle.clips[activeClip]) part.handle.play(activeClip);
      const targetIds = ids ?? primary.ids();
      for (const id of targetIds) writeSecondaryPlayback(part, id);
      part.playbackStream.flush(part.set.count, force);
    }
  };

  let secondarySyncDepth = 0;
  let secondarySyncAll = false;
  let secondarySyncForce = false;
  let secondarySyncSharedClip = false;
  const pendingSecondaryIds = new Set<InstanceId>();

  const requestSecondaryPlayback = (
    ids?: Iterable<InstanceId>,
    force = false,
    syncSharedClip = false
  ): void => {
    if (secondarySyncDepth === 0) {
      synchronizeSecondaryPlayback(ids, force, syncSharedClip);
      return;
    }
    if (ids === undefined) {
      secondarySyncAll = true;
      pendingSecondaryIds.clear();
    } else if (!secondarySyncAll) {
      for (const id of ids) pendingSecondaryIds.add(id);
    }
    secondarySyncForce ||= force;
    secondarySyncSharedClip ||= syncSharedClip;
  };

  const flushRequestedSecondaryPlayback = (): void => {
    if (!secondarySyncAll && pendingSecondaryIds.size === 0 && !secondarySyncForce && !secondarySyncSharedClip) return;
    synchronizeSecondaryPlayback(
      secondarySyncAll ? undefined : pendingSecondaryIds,
      secondarySyncForce,
      secondarySyncSharedClip
    );
    secondarySyncAll = false;
    secondarySyncForce = false;
    secondarySyncSharedClip = false;
    pendingSecondaryIds.clear();
  };

  const mirrorMatrix = (id: InstanceId, matrix: Mat4): void => {
    for (const part of secondary) {
      const secondaryId = part.secondaryByPrimary.get(id);
      if (secondaryId !== undefined) part.set.setMatrix(secondaryId, matrix);
    }
  };

  const mirrorVisibility = (id: InstanceId, visible: boolean): void => {
    for (const part of secondary) {
      const secondaryId = part.secondaryByPrimary.get(id);
      if (secondaryId !== undefined) part.set.setVisible(secondaryId, visible);
    }
  };

  const api: VatCharacterSet<TMetadata> = {
    root,
    primary,
    secondaryParts: secondary.map((part) => ({ mesh: part.mesh, playbackStats: part.playbackStream.stats })),
    clips: primary.clips,
    get activeClip() {
      return primary.activeClip;
    },
    get timeSeconds() {
      return primary.timeSeconds;
    },
    get count() {
      return primary.count;
    },
    get capacity() {
      return primary.capacity;
    },
    get visibleCount() {
      return primary.visibleCount;
    },
    create(createOptions = {}) {
      const id = primary.create(createOptions);
      for (const part of secondary) {
        const secondaryId = part.set.create(createOptions.transform);
        part.primaryBySecondary.set(secondaryId, id);
        part.secondaryByPrimary.set(id, secondaryId);
      }
      synchronizeSecondaryPlayback([id]);
      return id;
    },
    createMany(items) {
      const createOptions = Array.from(items);
      const ids = primary.createMany(createOptions);
      for (let index = 0; index < ids.length; index++) {
        const id = ids[index]!;
        const options = createOptions[index]!;
        for (const part of secondary) {
          const secondaryId = part.set.create(options.transform);
          part.primaryBySecondary.set(secondaryId, id);
          part.secondaryByPrimary.set(id, secondaryId);
        }
      }
      synchronizeSecondaryPlayback(ids);
      return ids;
    },
    remove(id) {
      if (!primary.remove(id)) return false;
      for (const part of secondary) {
        const secondaryId = part.secondaryByPrimary.get(id);
        if (secondaryId !== undefined) {
          part.set.remove(secondaryId);
          part.primaryBySecondary.delete(secondaryId);
          part.secondaryByPrimary.delete(id);
        }
      }
      synchronizeSecondaryPlayback([]);
      return true;
    },
    clear() {
      primary.clear();
      for (const part of secondary) {
        part.set.clear();
        part.primaryBySecondary.clear();
        part.secondaryByPrimary.clear();
        part.playbackStream.flush(0, true);
      }
    },
    has: (id) => primary.has(id),
    getVisible: (id) => primary.getVisible(id),
    setVisible(id, visible) {
      primary.setVisible(id, visible);
      mirrorVisibility(id, visible);
      synchronizeSecondaryPlayback([]);
    },
    setMatrix(id, matrix) {
      primary.setMatrix(id, matrix);
      mirrorMatrix(id, matrix);
    },
    setTransform(id, transform) {
      primary.setTransform(id, transform);
      mirrorMatrix(id, primary.getMatrix(id));
    },
    getMatrix: (id, out) => primary.getMatrix(id, out),
    play(clip) {
      const changed = primary.play(clip);
      if (changed) requestSecondaryPlayback(undefined, false, true);
      return changed;
    },
    update(deltaSeconds) {
      primary.update(deltaSeconds);
      for (const part of secondary) part.handle.update(deltaSeconds);
    },
    setClip(id, clip) {
      const changed = primary.setClip(id, clip);
      if (changed) requestSecondaryPlayback([id]);
      return changed;
    },
    setPhaseOffset(id, offset) {
      primary.setPhaseOffset(id, offset);
      requestSecondaryPlayback([id]);
    },
    setFps(id, fps) {
      primary.setFps(id, fps);
      requestSecondaryPlayback([id]);
    },
    batchPlayback(callback) {
      secondarySyncDepth++;
      try {
        return primary.batchPlayback(callback);
      } finally {
        secondarySyncDepth--;
        if (secondarySyncDepth === 0) flushRequestedSecondaryPlayback();
      }
    },
    getPlaybackSample: (id, out) => primary.getPlaybackSample(id, out),
    syncInstances() {
      primary.syncInstances();
      synchronizeSecondaryPlayback(undefined, true, true);
    },
    dispose() {
      primary.dispose();
      for (const part of secondary) {
        part.set.dispose();
        part.primaryBySecondary.clear();
        part.secondaryByPrimary.clear();
      }
    }
  };

  return api;
}

/** Find every skinned mesh below a GLB root in depth-first order. */
export function findSkinnedMeshes(root: SceneNode): Mesh[] {
  const meshes: Mesh[] = [];
  const stack: SceneNode[] = [root];
  while (stack.length > 0) {
    const node = stack.pop()!;
    if (isSkinnedMesh(node)) meshes.push(node);
    stack.push(...node.children);
  }
  return meshes;
}

function isSkinnedMesh(node: SceneNode): node is Mesh {
  return "skeleton" in node && !!node.skeleton;
}
