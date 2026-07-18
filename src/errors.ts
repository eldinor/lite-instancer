import type { InstanceId } from "./types.js";

/** Error thrown by `@litools/instancer` when an ID, capacity, or operation is invalid. */
export class InstancerError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InstancerError";
  }
}

/**
 * Assert that a capacity option is a non-negative integer.
 *
 * @param capacity - Value to validate.
 * @param name - Option name included in the error message.
 * @throws {@link InstancerError} When `capacity` is negative, fractional, or not finite.
 */
export function assertValidCapacity(capacity: number, name = "capacity"): void {
  if (!Number.isInteger(capacity) || capacity < 0) {
    throw new InstancerError(`${name} must be a non-negative integer`);
  }
}

/**
 * Return the backing slot for a known stable instance ID.
 *
 * @param id - Stable ID used in an error message when no slot exists.
 * @param slot - Slot resolved from an instance store.
 * @returns The resolved numeric slot.
 * @throws {@link InstancerError} When `slot` is `undefined`.
 */
export function assertKnownId(id: InstanceId, slot: number | undefined): number {
  if (slot === undefined) {
    throw new InstancerError(`Unknown instance id ${Number(id)}`);
  }
  return slot;
}
