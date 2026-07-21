import {
  createHostSlotStream,
  notifySlotCapacity,
  notifySlotCreated,
  notifySlotsSwapped,
  notifySlotsTruncated,
  registerSlotStreamHost,
  type SlotDirtyRange
} from "../src/slot-aligned-stream.js";
import { defineSlotAlignedStreamContract } from "./contracts/slot-aligned-stream-contract.js";

defineSlotAlignedStreamContract("Babylon Lite", () => {
  const owner = {};
  const uploaded: SlotDirtyRange[][] = [];
  registerSlotStreamHost(owner, 2);
  const stream = createHostSlotStream(owner, {
    components: 4,
    backend: {
      bind() {},
      upload: (_data, _count, ranges) => {
        uploaded.push([...ranges]);
      }
    }
  });
  return {
    stream,
    create: (slot) => notifySlotCreated(owner, slot),
    swap: (a, b) => notifySlotsSwapped(owner, a, b),
    grow: (capacity) => notifySlotCapacity(owner, capacity),
    truncate: (count) => notifySlotsTruncated(owner, count),
    uploads: () => uploaded
  };
});
