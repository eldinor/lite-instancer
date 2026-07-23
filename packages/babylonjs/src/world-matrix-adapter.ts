import { Matrix } from "@babylonjs/core/Maths/math.vector.js";
import type { Mesh } from "@babylonjs/core/Meshes/mesh.js";
import { InstancerError } from "./errors.js";
import type { Mat4 } from "./types.js";

/**
 * Convert application-level world transforms into Babylon thin-instance
 * matrices while preserving a mesh's authored parent/world transform.
 */
export class MeshWorldMatrixAdapter {
  readonly #mesh: Mesh;
  readonly #logical = Matrix.Identity();
  readonly #inverseWorld = Matrix.Identity();
  readonly #worldLogical = Matrix.Identity();
  readonly #adapted = Matrix.Identity();
  #prepared = false;

  constructor(mesh: Mesh) {
    this.#mesh = mesh;
  }

  /** Prepare the authored mesh transform once before writing one or more slots. */
  prepare(): void {
    const world = this.#mesh.computeWorldMatrix(true);
    if (Math.abs(world.determinant()) < 1e-12) {
      throw new InstancerError(`Cannot instance mesh '${this.#mesh.name}' with a non-invertible world transform`);
    }
    world.invertToRef(this.#inverseWorld);
    this.#prepared = true;
  }

  write(logicalMatrices: ArrayLike<number>, logicalOffset: number, target: Float32Array, targetOffset: number): void {
    this.prepare();
    this.writePrepared(logicalMatrices, logicalOffset, target, targetOffset);
  }

  writePrepared(logicalMatrices: ArrayLike<number>, logicalOffset: number, target: Float32Array, targetOffset: number): void {
    if (!this.#prepared) this.prepare();
    const world = this.#mesh.getWorldMatrix();
    Matrix.FromArrayToRef(logicalMatrices, logicalOffset, this.#logical);

    // Babylon evaluates thin * meshWorld. Application transforms are defined
    // after the authored mesh transform, so solve:
    // adapted * meshWorld = meshWorld * logical.
    world.multiplyToRef(this.#logical, this.#worldLogical);
    this.#worldLogical.multiplyToRef(this.#inverseWorld, this.#adapted);
    this.#adapted.copyToArray(target, targetOffset);
  }

  writeSlot(logicalMatrices: ArrayLike<number>, target: Float32Array, slot: number): void {
    this.write(logicalMatrices, slot * 16, target, slot * 16);
  }

  writeSlotPrepared(logicalMatrices: ArrayLike<number>, target: Float32Array, slot: number): void {
    this.writePrepared(logicalMatrices, slot * 16, target, slot * 16);
  }
}

/** Compose the effective Babylon world matrix for a logical instance transform. */
export function composeInstanceWorldMatrix(mesh: Mesh, logical: Mat4, out = Matrix.Identity()): Matrix {
  const logicalMatrix = Matrix.FromArray(logical);
  mesh.computeWorldMatrix(true).multiplyToRef(logicalMatrix, out);
  return out;
}
