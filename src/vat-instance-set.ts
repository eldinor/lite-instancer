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

export interface VatInstanceSetOptions extends Omit<InstanceSetOptions, "gpuCulling"> {
  /**
   * VAT can move vertices outside authored/rest bounds, so GPU culling defaults to false.
   * Enable only when bounds are known to stay valid.
   */
  gpuCulling?: boolean;
  clip?: string;
}

export interface VatInstanceCreateOptions<TMetadata = unknown> {
  transform?: InstanceTransformInput;
  metadata?: TMetadata;
  offset?: number;
  fps?: number;
}

export interface VatInstanceSet<TMetadata = unknown> {
  readonly set: ColoredInstanceSet<TMetadata>;
  readonly mesh: Mesh;
  readonly handle: VatHandle;
  readonly clips: Record<string, VatClip>;
  readonly activeClip: string | undefined;

  create(options?: VatInstanceCreateOptions<TMetadata>): InstanceId;
  remove(id: InstanceId): boolean;
  clear(): void;
  getActiveClip(): VatClip | undefined;
  play(clip: string): boolean;
  update(deltaSeconds: number): void;
  setPhaseOffset(id: InstanceId, offset: number): void;
  setFps(id: InstanceId, fps: number | undefined): void;
  syncInstances(): void;
}

interface VatInstancePlayback {
  offset: number;
  fps?: number;
}

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
      playback.set(
        id,
        createPlayback(createOptions.offset ?? getDefaultOffset(set.count - 1, set.count, api.getActiveClip()), createOptions.fps)
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
      playback.set(id, createPlayback(current.offset, fps));
      api.syncInstances();
    },
    syncInstances() {
      const clip = api.getActiveClip();
      if (!clip || set.count === 0) {
        return;
      }
      const params = new Float32Array(set.count * 4);
      for (let slot = 0; slot < set.count; slot++) {
        const id = set.getIdForSlot(slot);
        const item = id === undefined ? undefined : playback.get(id);
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

function createPlayback(offset: number, fps: number | undefined): VatInstancePlayback {
  return fps === undefined ? { offset } : { offset, fps };
}
