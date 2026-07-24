declare module "@litools/instancer" {
  import type { Mat4, Mesh } from "@babylonjs/lite";

  export type InstanceId = number & { readonly __brand: unique symbol };

  export interface InstanceSet<TMetadata = unknown> {
    readonly mesh: Mesh;
    getMatrixOrUndefined(id: InstanceId, out?: Mat4): Mat4 | undefined;
    getVisibleOrUndefined(id: InstanceId): boolean | undefined;
    getMetadata(id: InstanceId): TMetadata | undefined;
  }
}
