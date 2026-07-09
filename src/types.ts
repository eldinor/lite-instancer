import type { EngineContext, Mat4 } from "@babylonjs/lite";

export type InstanceId = number & { readonly __brand: unique symbol };

export type Vec3Like = readonly [number, number, number] | Float32Array | Float64Array;
export type QuatLike = readonly [number, number, number, number] | Float32Array | Float64Array;
export type InstanceColorInput = readonly [number, number, number, number] | Float32Array | Float64Array;

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
export type VisibilityStrategy = "active-count" | "scale-zero";

export interface InstanceSetOptions {
  capacity?: number;
  grow?: GrowStrategy;
  engine?: EngineContext;
  gpuCulling?: boolean;
  colors?: boolean;
  visibleStrategy?: VisibilityStrategy;
}

export interface HierarchyInstanceSetOptions {
  capacity?: number;
  grow?: HierarchyGrowStrategy;
  engine?: EngineContext;
  gpuCulling?: boolean;
  visibleStrategy?: VisibilityStrategy;
}

export interface InstanceBatchWriter<TMetadata = unknown> {
  setMatrix(id: InstanceId, matrix: Mat4): void;
  setTransform(id: InstanceId, transform: InstanceTransformInput): void;
  setVisible(id: InstanceId, visible: boolean): void;
  setMetadata(id: InstanceId, metadata: TMetadata): void;
  setColor?(id: InstanceId, color: InstanceColorInput): void;
}

export interface RawInstanceWriter {
  readonly matrices: Float32Array | Float64Array;
  readonly colors?: Float32Array;
  getSlot(id: InstanceId): number | undefined;
  writeMatrix(id: InstanceId, matrix: Mat4): void;
  writeColor(id: InstanceId, color: InstanceColorInput): void;
  markMatrixDirty(slot: number): void;
  markColorDirty(slot: number): void;
}

export function toInstanceId(value: number): InstanceId {
  return value as InstanceId;
}
