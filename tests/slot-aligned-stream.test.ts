import {
  SlotAlignedFloatStream,
  coalesceDirtySlots,
  createHostSlotStream,
  notifySlotCapacity,
  notifySlotCreated,
  notifySlotsSwapped,
  notifySlotsTruncated,
  registerSlotStreamHost
} from "../src/slot-aligned-stream.js";

describe("SlotAlignedFloatStream", () => {
  it("coalesces sorted and duplicate dirty slots", () => {
    expect(coalesceDirtySlots([5, 2, 3, 3, 9])).toEqual([
      { start: 2, end: 3 },
      { start: 5, end: 5 },
      { start: 9, end: 9 }
    ]);
  });

  it("keeps values aligned through lifecycle changes", () => {
    const uploads: Array<{ count: number; ranges: unknown }> = [];
    const owner = {};
    registerSlotStreamHost(owner, 2);
    const stream = createHostSlotStream(owner, {
      components: 2,
      defaultValue: [1, 1],
      backend: {
        bind: vi.fn(),
        upload: (_data, count, ranges) => uploads.push({ count, ranges })
      }
    });

    notifySlotCreated(owner, 0);
    notifySlotCreated(owner, 1);
    stream.setSlot(0, [10, 11]);
    stream.setSlot(1, [20, 21]);
    notifySlotsSwapped(owner, 0, 1);
    stream.flush(2);

    expect(Array.from(stream.getSlot(0))).toEqual([20, 21]);
    expect(Array.from(stream.getSlot(1))).toEqual([10, 11]);
    expect(uploads).toHaveLength(1);
    expect(stream.stats.dirtySlotsFlushed).toBe(2);

    notifySlotCapacity(owner, 4);
    notifySlotCreated(owner, 2);
    expect(Array.from(stream.getSlot(2))).toEqual([1, 1]);
    notifySlotsTruncated(owner, 2);
    expect(stream.capacity).toBe(4);
  });

  it("lets a future partial-update backend consume exact ranges", () => {
    const upload = vi.fn();
    const stream = new SlotAlignedFloatStream({ components: 4, backend: { bind: vi.fn(), upload } });
    stream.resize(8);
    stream.setSlot(1, [1, 1, 1, 1]);
    stream.setSlot(2, [2, 2, 2, 2]);
    stream.setSlot(6, [6, 6, 6, 6]);
    stream.flush(8);
    expect(upload.mock.calls[0]?.[2]).toEqual([{ start: 1, end: 2 }, { start: 6, end: 6 }]);
  });
});
