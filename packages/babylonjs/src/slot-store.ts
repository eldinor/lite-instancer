import { assertKnownId, InstancerError } from "./errors.js";
import {
  type InstanceEntry,
  type InstanceId,
  type InstanceMetadataPredicate,
  type InstanceMetadataUpdater,
  type InstanceSlotEntry,
  toInstanceId
} from "./types.js";

export type SlotSwapCallback = (a: number, b: number) => void;

/**
 * Shared stable-ID, slot-order, active-count visibility, and metadata bookkeeping.
 *
 * Rendering backends own the actual per-slot buffers; this store only owns logical IDs and invokes
 * a callback when two backing slots must be swapped.
 */
export class InstanceSlotStore<TMetadata> {
  #count = 0;
  #visibleCount = 0;
  #nextId = 1;
  #idToSlot = new Map<InstanceId, number>();
  #slotToId: InstanceId[] = [];
  #metadata = new Map<InstanceId, TMetadata>();

  constructor(readonly label: string) {}

  get count(): number {
    return this.#count;
  }

  get visibleCount(): number {
    return this.#visibleCount;
  }

  create(metadata?: TMetadata): { id: InstanceId; slot: number } {
    const id = toInstanceId(this.#nextId++);
    const slot = this.#count++;
    this.#slotToId[slot] = id;
    this.#idToSlot.set(id, slot);
    if (metadata !== undefined) {
      this.#metadata.set(id, metadata);
    }
    return { id, slot };
  }

  remove(id: InstanceId, swapSlots: SlotSwapCallback): boolean {
    const slot = this.#idToSlot.get(id);
    if (slot === undefined) {
      return false;
    }

    if (slot < this.#visibleCount) {
      const lastVisible = this.#visibleCount - 1;
      this.#swapSlots(slot, lastVisible, swapSlots);
      this.#visibleCount--;
      const removedSlot = this.#visibleCount;
      if (removedSlot !== this.#count - 1) {
        this.#swapSlots(removedSlot, this.#count - 1, swapSlots);
      }
    } else if (slot !== this.#count - 1) {
      this.#swapSlots(slot, this.#count - 1, swapSlots);
    }

    this.#count--;
    this.#slotToId.length = this.#count;
    this.#idToSlot.delete(id);
    this.#metadata.delete(id);
    return true;
  }

  removeMany(ids: Iterable<InstanceId>, remove: (id: InstanceId) => boolean): number {
    let removed = 0;
    for (const id of ids) {
      if (remove(id)) {
        removed++;
      }
    }
    return removed;
  }

  clear(): void {
    this.#count = 0;
    this.#visibleCount = 0;
    this.#slotToId = [];
    this.#idToSlot.clear();
    this.#metadata.clear();
  }

  has(id: InstanceId): boolean {
    return this.#idToSlot.has(id);
  }

  getSlot(id: InstanceId): number | undefined {
    return this.#idToSlot.get(id);
  }

  requireSlot(id: InstanceId): number {
    return assertKnownId(id, this.getSlot(id));
  }

  getIdForSlot(slot: number): InstanceId | undefined {
    return this.#slotToId[slot];
  }

  getActiveCountVisible(id: InstanceId): boolean {
    return this.requireSlot(id) < this.#visibleCount;
  }

  setActiveCountVisible(id: InstanceId, visible: boolean, swapSlots: SlotSwapCallback): boolean {
    const slot = this.requireSlot(id);
    const currentlyVisible = slot < this.#visibleCount;
    if (currentlyVisible === visible) {
      return false;
    }
    if (visible) {
      this.#swapSlots(slot, this.#visibleCount, swapSlots);
      this.#visibleCount++;
    } else {
      this.#visibleCount--;
      this.#swapSlots(slot, this.#visibleCount, swapSlots);
    }
    return true;
  }

  *ids(): IterableIterator<InstanceId> {
    for (let slot = 0; slot < this.#count; slot++) {
      const id = this.#slotToId[slot];
      if (id !== undefined) {
        yield id;
      }
    }
  }

  *visibleIds(isVisible: (id: InstanceId) => boolean): IterableIterator<InstanceId> {
    for (const id of this.ids()) {
      if (isVisible(id)) {
        yield id;
      }
    }
  }

  *slots(): IterableIterator<InstanceSlotEntry> {
    for (let slot = 0; slot < this.#count; slot++) {
      const id = this.#slotToId[slot];
      if (id !== undefined) {
        yield { id, slot };
      }
    }
  }

  *entries(): IterableIterator<InstanceEntry<TMetadata>> {
    for (const { id, slot } of this.slots()) {
      const metadata = this.#metadata.get(id);
      if (metadata === undefined) {
        yield { id, slot };
      } else {
        yield { id, slot, metadata };
      }
    }
  }

  forEach(callback: (id: InstanceId, slot: number) => void): void {
    for (const { id, slot } of this.slots()) {
      callback(id, slot);
    }
  }

  getMetadata(id: InstanceId): TMetadata | undefined {
    return this.#metadata.get(id);
  }

  setMetadata(id: InstanceId, metadata: TMetadata): void {
    this.requireSlot(id);
    this.#metadata.set(id, metadata);
  }

  trySetMetadata(id: InstanceId, metadata: TMetadata): boolean {
    if (!this.has(id)) {
      return false;
    }
    this.setMetadata(id, metadata);
    return true;
  }

  findByMetadata(predicate: InstanceMetadataPredicate<TMetadata>): InstanceId | undefined {
    for (const { id, slot } of this.slots()) {
      const metadata = this.#metadata.get(id);
      if (metadata !== undefined && predicate(metadata, id, slot)) {
        return id;
      }
    }
    return undefined;
  }

  filterByMetadata(predicate: InstanceMetadataPredicate<TMetadata>): InstanceId[] {
    const ids: InstanceId[] = [];
    for (const { id, slot } of this.slots()) {
      const metadata = this.#metadata.get(id);
      if (metadata !== undefined && predicate(metadata, id, slot)) {
        ids.push(id);
      }
    }
    return ids;
  }

  updateMetadata(id: InstanceId, updater: InstanceMetadataUpdater<TMetadata>): TMetadata | undefined {
    this.requireSlot(id);
    const next = updater(this.#metadata.get(id), id);
    if (next === undefined) {
      this.#metadata.delete(id);
      return undefined;
    }
    this.#metadata.set(id, next);
    return next;
  }

  tryUpdateMetadata(id: InstanceId, updater: InstanceMetadataUpdater<TMetadata>): TMetadata | undefined {
    if (!this.has(id)) {
      return undefined;
    }
    return this.updateMetadata(id, updater);
  }

  deleteMetadata(id: InstanceId): boolean {
    return this.#metadata.delete(id);
  }

  #swapSlots(a: number, b: number, swapSlots: SlotSwapCallback): void {
    if (a === b) {
      return;
    }
    const aId = this.#slotToId[a];
    const bId = this.#slotToId[b];
    if (aId === undefined || bId === undefined) {
      throw new InstancerError(`Cannot swap empty ${this.label} slots`);
    }

    swapSlots(a, b);
    this.#slotToId[a] = bId;
    this.#slotToId[b] = aId;
    this.#idToSlot.set(aId, b);
    this.#idToSlot.set(bId, a);
  }
}

