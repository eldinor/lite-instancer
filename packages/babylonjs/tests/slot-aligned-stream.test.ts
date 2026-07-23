import { defineSlotAlignedStreamContract } from "../../../tests/contracts/slot-aligned-stream-contract.js";
import {
  SlotAlignedFloatStream,
  type SlotDirtyRange
} from "../src/slot-aligned-stream.js";

defineSlotAlignedStreamContract("Babylon.js", () => {
  const uploaded: Array<readonly SlotDirtyRange[]> = [];
  const stream = new SlotAlignedFloatStream({
    components: 4,
    defaultValue: [0, 0, 0, 0],
    backend: {
      bind: () => undefined,
      upload: (_data, _count, ranges) => {
        uploaded.push(ranges.map((range) => ({ ...range })));
      }
    }
  });
  stream.resize(2);
  return {
    stream,
    create: (slot) => stream.initializeSlot(slot),
    swap: (a, b) => stream.swapSlots(a, b),
    grow: (capacity) => stream.resize(capacity, 2),
    truncate: (count) => stream.truncate(count),
    uploads: () => uploaded
  };
});
