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

  create(options?: VatInstanceCreateOptions<TMetadata>): InstanceId;
  createMany(items: Iterable<VatInstanceCreateOptions<TMetadata>>): InstanceId[];
  remove(id: InstanceId): boolean;
  clear(): void;
  has(id: InstanceId): boolean;
  getVisible(id: InstanceId): boolean;
  setVisible(id: InstanceId, visible: boolean): void;
  setMatrix(id: InstanceId, matrix: Mat4): void;
  setTransform(id: InstanceId, transform: InstanceTransformInput): void;
  getMatrix(id: InstanceId, out?: Mat4): Mat4;
  play(clip: string): boolean;
  update(deltaSeconds: number): void;
  setClip(id: InstanceId, clip: string | undefined): boolean;
  setPhaseOffset(id: InstanceId, offset: number): void;
  setFps(id: InstanceId, fps: number | undefined): void;
  getPlaybackSample(id: InstanceId, out?: VatPlaybackSample): VatPlaybackSample | undefined;
  /** Re-upload synchronized secondary playback parameters after advanced primary-set changes. */
  syncInstances(): void;
  dispose(): void;
}

interface SecondaryPart {
  readonly mesh: Mesh;
  readonly handle: VatHandle;
  readonly set: ColoredInstanceSet;
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
  const secondary = skinnedMeshes.map<SecondaryPart>((mesh) => ({
    mesh,
    handle: attachVatSafely(engine, mesh, bakeVat(engine, mesh, animationGroups)),
    set: createInstanceSet(mesh, {
      ...instanceOptions,
      gpuCulling: options.gpuCulling ?? false,
      visibleStrategy: options.visibleStrategy ?? "scale-zero"
    }),
    primaryBySecondary: new Map(),
    secondaryByPrimary: new Map()
  }));

  for (const part of secondary) {
    for (const clipName of Object.keys(primary.clips)) {
      if (!part.handle.clips[clipName]) {
        throw new Error(`VAT character mesh part is missing baked clip \"${clipName}\".`);
      }
    }
  }

  const synchronizeSecondaryPlayback = (): void => {
    const activeClip = primary.activeClip;
    for (const part of secondary) {
      if (activeClip && part.handle.clips[activeClip]) {
        part.handle.play(activeClip);
      }
      const params = new Float32Array(part.set.count * 4);
      for (let slot = 0; slot < part.set.count; slot++) {
        const secondaryId = part.set.getIdForSlot(slot);
        const primaryId = secondaryId === undefined ? undefined : part.primaryBySecondary.get(secondaryId);
        const sample = primaryId === undefined ? undefined : primary.getPlaybackSample(primaryId);
        const clip = sample ? part.handle.clips[sample.clip] : undefined;
        if (!sample || !clip) continue;
        const offset = slot * 4;
        params[offset] = clip.fromRow;
        params[offset + 1] = clip.fromRow + clip.frameCount - 1;
        params[offset + 2] = sample.offsetSeconds * sample.fps;
        params[offset + 3] = sample.fps;
      }
      part.handle.setInstances(params);
    }
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
    secondaryParts: secondary.map((part) => ({ mesh: part.mesh })),
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
      synchronizeSecondaryPlayback();
      return id;
    },
    createMany(items) {
      const ids: InstanceId[] = [];
      for (const item of items) ids.push(api.create(item));
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
      synchronizeSecondaryPlayback();
      return true;
    },
    clear() {
      primary.clear();
      for (const part of secondary) {
        part.set.clear();
        part.primaryBySecondary.clear();
        part.secondaryByPrimary.clear();
        part.handle.setInstances(new Float32Array());
      }
    },
    has: (id) => primary.has(id),
    getVisible: (id) => primary.getVisible(id),
    setVisible(id, visible) {
      primary.setVisible(id, visible);
      mirrorVisibility(id, visible);
      synchronizeSecondaryPlayback();
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
      if (changed) synchronizeSecondaryPlayback();
      return changed;
    },
    update(deltaSeconds) {
      primary.update(deltaSeconds);
      for (const part of secondary) part.handle.update(deltaSeconds);
    },
    setClip(id, clip) {
      const changed = primary.setClip(id, clip);
      if (changed) synchronizeSecondaryPlayback();
      return changed;
    },
    setPhaseOffset(id, offset) {
      primary.setPhaseOffset(id, offset);
      synchronizeSecondaryPlayback();
    },
    setFps(id, fps) {
      primary.setFps(id, fps);
      synchronizeSecondaryPlayback();
    },
    getPlaybackSample: (id, out) => primary.getPlaybackSample(id, out),
    syncInstances() {
      primary.syncInstances();
      synchronizeSecondaryPlayback();
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
