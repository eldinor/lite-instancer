import type { Mat4 } from "@babylonjs/lite";
import type { InstanceId, InstanceSet } from "@litools/instancer";
import { presetPoint, transformPoint } from "./anchors.js";
import type { AnchorPreset, AnchorResolution, ResolvableAnchor, Vec3Like } from "./types.js";

export interface InstanceLocalBounds {
  readonly minimum: Vec3Like;
  readonly maximum: Vec3Like;
}

export interface InstanceAnchorOptions {
  readonly localPoint?: Vec3Like;
  readonly preset?: AnchorPreset;
  /**
   * Local geometry bounds used by presets. Babylon Lite exposes only aggregate
   * world bounds for thin-instance meshes, so callers must provide reusable
   * local bounds when a preset other than the instance origin is required.
   */
  readonly localBounds?: InstanceLocalBounds;
}

export interface InstanceAnchor<TMetadata = unknown> extends ResolvableAnchor {
  readonly instanceSet: InstanceSet<TMetadata>;
  readonly instanceId: InstanceId;
}

/** Create an anchor that resolves a stable instance ID on every layer update. */
export function createInstanceAnchor<TMetadata>(
  instanceSet: InstanceSet<TMetadata>,
  instanceId: InstanceId,
  options: InstanceAnchorOptions = {}
): InstanceAnchor<TMetadata> {
  const localPoint = options.localPoint
    ? new Float64Array([
        options.localPoint[0] ?? 0,
        options.localPoint[1] ?? 0,
        options.localPoint[2] ?? 0
      ])
    : createPresetLocalPoint(options);
  const matrixScratch = new Float32Array(16) as Mat4;

  return Object.freeze({
    kind: "resolver" as const,
    instanceSet,
    instanceId,
    resolve(out: Float32Array): AnchorResolution {
      try {
        const matrix = instanceSet.getMatrixOrUndefined(instanceId, matrixScratch);
        if (!matrix) return { available: false, targetVisible: false };
        const visible = instanceSet.getVisibleOrUndefined(instanceId);
        if (visible === undefined) return { available: false, targetVisible: false };
        transformPoint(localPoint, matrix, out);
        return { available: true, targetVisible: visible, position: out };
      } catch {
        return { available: false, targetVisible: false };
      }
    }
  });
}

function createPresetLocalPoint(options: InstanceAnchorOptions): Float64Array {
  if (!options.localBounds) return new Float64Array(3);
  const out = new Float32Array(3);
  presetPoint(
    options.localBounds.minimum,
    options.localBounds.maximum,
    options.preset ?? "center",
    out
  );
  return new Float64Array(out);
}

export type { InstanceId, InstanceSet } from "@litools/instancer";
