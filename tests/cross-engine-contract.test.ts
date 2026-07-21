import { InstanceSlotStore as LiteSlotStore } from "../src/slot-store.js";
import { InstanceSlotStore as BabylonSlotStore } from "../packages/babylonjs/src/slot-store.js";

interface ContractStore {
  create(metadata?: string): { id: number; slot: number };
  setActiveCountVisible(id: number, visible: boolean, swap: (left: number, right: number) => void): boolean;
  remove(id: number, swap: (left: number, right: number) => void): boolean;
  has(id: number): boolean;
  getMetadata(id: number): string | undefined;
  ids(): IterableIterator<number>;
}

describe.each([
  ["Babylon Lite", () => new LiteSlotStore<string>("instance") as unknown as ContractStore],
  ["Babylon.js", () => new BabylonSlotStore<string>("instance") as unknown as ContractStore]
])("stable-ID contract: %s", (_name, createStore) => {
  it("keeps identity and metadata stable through visibility swaps and removal", () => {
    const store = createStore();
    const swaps: Array<[number, number]> = [];
    const a = store.create("a").id;
    const b = store.create("b").id;
    const c = store.create("c").id;
    const swap = (left: number, right: number) => swaps.push([left, right]);
    store.setActiveCountVisible(a, true, swap);
    store.setActiveCountVisible(b, true, swap);
    store.setActiveCountVisible(c, true, swap);
    store.setActiveCountVisible(b, false, swap);
    store.remove(a, swap);

    expect(store.has(c)).toBe(true);
    expect(store.getMetadata(c)).toBe("c");
    expect(Array.from(store.ids())).toContain(c);
    expect(swaps.length).toBeGreaterThan(0);
  });
});
