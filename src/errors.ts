import type { InstanceId } from "./types.js";

export class InstancerError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InstancerError";
  }
}

export function assertValidCapacity(capacity: number, name = "capacity"): void {
  if (!Number.isInteger(capacity) || capacity < 0) {
    throw new InstancerError(`${name} must be a non-negative integer`);
  }
}

export function assertKnownId(id: InstanceId, slot: number | undefined): number {
  if (slot === undefined) {
    throw new InstancerError(`Unknown instance id ${Number(id)}`);
  }
  return slot;
}
