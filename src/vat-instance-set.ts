import {
  attachVat,
  bakeVat,
  type AnimationGroup,
  type EngineContext,
  type Mesh,
  type VatClip,
  type VatHandle
} from "@babylonjs/lite";
import { createInstanceSet, type ColoredInstanceSet } from "./instance-set.js";
import type { InstanceId, InstanceSetOptions, InstanceTransformInput } from "./types.js";

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

  /** Create an animated instance and return its stable ID. */
  create(options?: VatInstanceCreateOptions<TMetadata>): InstanceId;
  /** Remove an animated instance. */
  remove(id: InstanceId): boolean;
  /** Remove every animated instance. */
  clear(): void;
  /** Return the shared default clip data. */
  getActiveClip(): VatClip | undefined;
  /** Return an instance's effective clip name, including the shared default fallback. */
  getClip(id: InstanceId): string | undefined;
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
  const playback = new Map<InstanceId, VatInstancePlayback>();

  const api: VatInstanceSet<TMetadata> = {
    set,
    mesh,
    handle,
    clips: handle.clips,
    get activeClip() {
      return activeClip;
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
    remove(id) {
      const removed = set.remove(id);
      if (removed) {
        playback.delete(id);
        api.syncInstances();
      }
      return removed;
    },
    clear() {
      set.clear();
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
        params[slot * 4 + 2] = item?.offset ?? getDefaultOffset(slot, set.count, clip);
        params[slot * 4 + 3] = item?.fps ?? clip.fps;
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
