import type { SlotDirtyRange } from "../../src/slot-aligned-stream.js";

export interface ContractSlotAlignedFloatStream {
  readonly capacity: number;
  setSlot(slot: number, value: ArrayLike<number>): void;
  getSlot(slot: number, out?: Float32Array): Float32Array;
  flush(count: number, force?: boolean): void;
}

export interface ContractStreamHarness {
  readonly stream: ContractSlotAlignedFloatStream;
  create(slot: number): void;
  swap(a: number, b: number): void;
  grow(capacity: number): void;
  truncate(count: number): void;
  uploads(): readonly (readonly SlotDirtyRange[])[];
}

/** Reusable behavior suite for the Lite stream and the future Babylon.js adapter. */
export function defineSlotAlignedStreamContract(name: string, createHarness: () => ContractStreamHarness): void {
  describe(`slot-aligned stream contract: ${name}`, () => {
    it("preserves values and reports compact ranges across slot lifecycle operations", () => {
      const harness = createHarness();
      harness.create(0);
      harness.create(1);
      harness.stream.setSlot(0, [10, 11, 12, 13]);
      harness.stream.setSlot(1, [20, 21, 22, 23]);
      harness.swap(0, 1);
      harness.stream.flush(2);
      expect(Array.from(harness.stream.getSlot(0))).toEqual([20, 21, 22, 23]);
      expect(Array.from(harness.stream.getSlot(1))).toEqual([10, 11, 12, 13]);
      expect(harness.uploads().at(-1)).toEqual([{ start: 0, end: 1 }]);
      harness.grow(4);
      harness.create(2);
      harness.truncate(2);
      expect(harness.stream.capacity).toBe(4);
    });
  });
}
