/** A contiguous inclusive range of dirty instance slots. */
export interface SlotDirtyRange {
  readonly start: number;
  readonly end: number;
}

export interface SlotAlignedFloatStreamUploadResult {
  readonly calls: number;
  readonly bytes: number;
}

export interface SlotAlignedFloatStreamBackend {
  bind(data: Float32Array, capacity: number): void;
  upload(
    data: Float32Array,
    count: number,
    ranges: readonly SlotDirtyRange[],
    force: boolean
  ): SlotAlignedFloatStreamUploadResult | void;
  dispose?(): void;
}

export interface SlotAlignedFloatStreamOptions {
  readonly components: number;
  readonly defaultValue?: readonly number[];
  readonly backend: SlotAlignedFloatStreamBackend;
}

export interface SlotAlignedFloatStreamStats {
  allocations: number;
  slotWrites: number;
  flushes: number;
  forcedFlushes: number;
  dirtySlotsFlushed: number;
  cpuBytesFlushed: number;
  backendUploadCalls: number;
  backendBytesUploaded: number;
}

/** Capacity-owned float data that follows compact renderer slots. */
export class SlotAlignedFloatStream {
  readonly components: number;
  readonly stats: SlotAlignedFloatStreamStats = {
    allocations: 0,
    slotWrites: 0,
    flushes: 0,
    forcedFlushes: 0,
    dirtySlotsFlushed: 0,
    cpuBytesFlushed: 0,
    backendUploadCalls: 0,
    backendBytesUploaded: 0
  };

  #backend: SlotAlignedFloatStreamBackend;
  #defaultValue: Float32Array;
  #data = new Float32Array(0);
  #capacity = 0;
  #dirty = new Set<number>();
  #views = new Map<number, Float32Array>();
  #disposed = false;

  constructor(options: SlotAlignedFloatStreamOptions) {
    if (!Number.isInteger(options.components) || options.components <= 0) {
      throw new Error("SlotAlignedFloatStream components must be a positive integer.");
    }
    if (options.defaultValue && options.defaultValue.length !== options.components) {
      throw new Error("SlotAlignedFloatStream defaultValue length must match components.");
    }
    this.components = options.components;
    this.#backend = options.backend;
    this.#defaultValue = options.defaultValue
      ? Float32Array.from(options.defaultValue)
      : new Float32Array(options.components);
  }

  get capacity(): number { return this.#capacity; }
  get data(): Float32Array { return this.#data; }
  get dirtyCount(): number { return this.#dirty.size; }

  isDirty(slot: number): boolean {
    this.#assertSlot(slot);
    return this.#dirty.has(slot);
  }

  resize(capacity: number, liveCount = 0): void {
    this.#assertUsable();
    if (!Number.isInteger(capacity) || capacity < this.#capacity || liveCount < 0 || liveCount > capacity) {
      throw new Error("Invalid SlotAlignedFloatStream capacity or live count.");
    }
    if (capacity === this.#capacity) return;
    const next = new Float32Array(capacity * this.components);
    next.set(this.#data.subarray(0, Math.min(this.#data.length, liveCount * this.components)));
    this.#data = next;
    this.#capacity = capacity;
    this.#views.clear();
    this.stats.allocations++;
    this.#backend.bind(this.#data, capacity);
  }

  initializeSlot(slot: number): void {
    this.#assertSlot(slot);
    this.#data.set(this.#defaultValue, slot * this.components);
    this.#dirty.add(slot);
    this.stats.slotWrites++;
  }

  setSlot(slot: number, value: ArrayLike<number>): void {
    this.#assertSlot(slot);
    if (value.length !== this.components) throw new Error("SlotAlignedFloatStream value length must match components.");
    const offset = slot * this.components;
    let changed = false;
    for (let component = 0; component < this.components; component++) {
      const next = value[component] ?? 0;
      if (this.#data[offset + component] !== next) changed = true;
      this.#data[offset + component] = next;
    }
    if (!changed) return;
    this.#dirty.add(slot);
    this.stats.slotWrites++;
  }

  getSlot(slot: number, out = new Float32Array(this.components)): Float32Array {
    this.#assertSlot(slot);
    out.set(this.#data.subarray(slot * this.components, (slot + 1) * this.components));
    return out;
  }

  swapSlots(a: number, b: number): void {
    this.#assertSlot(a);
    this.#assertSlot(b);
    if (a === b) return;
    const aOffset = a * this.components;
    const bOffset = b * this.components;
    for (let component = 0; component < this.components; component++) {
      const value = this.#data[aOffset + component] ?? 0;
      this.#data[aOffset + component] = this.#data[bOffset + component] ?? 0;
      this.#data[bOffset + component] = value;
    }
    this.#dirty.add(a);
    this.#dirty.add(b);
    this.stats.slotWrites += 2;
  }

  truncate(count: number): void {
    this.#assertUsable();
    if (!Number.isInteger(count) || count < 0 || count > this.#capacity) throw new Error("Invalid stream live count.");
    for (const slot of this.#dirty) if (slot >= count) this.#dirty.delete(slot);
  }

  clear(): void { this.#assertUsable(); this.#dirty.clear(); }
  markDirty(slot: number): void { this.#assertSlot(slot); this.#dirty.add(slot); }
  markAllDirty(count: number): void { this.#assertUsable(); for (let slot = 0; slot < count; slot++) this.#dirty.add(slot); }
  dirtyRanges(): SlotDirtyRange[] { return coalesceDirtySlots(this.#dirty); }

  flush(count: number, force = false): void {
    this.#assertUsable();
    if (!Number.isInteger(count) || count < 0 || count > this.#capacity) throw new Error("Invalid stream flush count.");
    if (!force && this.#dirty.size === 0) return;
    const ranges = force && count > 0
      ? [{ start: 0, end: count - 1 }]
      : this.dirtyRanges().filter((range) => range.start < count)
          .map((range) => ({ start: range.start, end: Math.min(range.end, count - 1) }));
    if (ranges.length === 0) { this.#dirty.clear(); return; }
    const dirtySlots = ranges.reduce((total, range) => total + range.end - range.start + 1, 0);
    this.stats.flushes++;
    if (force) this.stats.forcedFlushes++;
    this.stats.dirtySlotsFlushed += dirtySlots;
    this.stats.cpuBytesFlushed += dirtySlots * this.components * Float32Array.BYTES_PER_ELEMENT;
    const result = this.#backend.upload(this.view(count), count, ranges, force);
    if (result) {
      this.stats.backendUploadCalls += result.calls;
      this.stats.backendBytesUploaded += result.bytes;
    }
    this.#dirty.clear();
  }

  view(count: number): Float32Array {
    if (count === this.#capacity) return this.#data;
    let view = this.#views.get(count);
    if (!view) {
      view = this.#data.subarray(0, count * this.components);
      this.#views.set(count, view);
    }
    return view;
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    this.#dirty.clear();
    this.#views.clear();
    this.#backend.dispose?.();
  }

  #assertSlot(slot: number): void {
    this.#assertUsable();
    if (!Number.isInteger(slot) || slot < 0 || slot >= this.#capacity) {
      throw new Error(`Slot ${slot} is outside stream capacity ${this.#capacity}.`);
    }
  }
  #assertUsable(): void { if (this.#disposed) throw new Error("SlotAlignedFloatStream is disposed."); }
}

export function coalesceDirtySlots(slots: Iterable<number>): SlotDirtyRange[] {
  const sorted = Array.from(new Set(slots)).sort((a, b) => a - b);
  const ranges: SlotDirtyRange[] = [];
  for (const slot of sorted) {
    const last = ranges[ranges.length - 1];
    if (last && slot === last.end + 1) ranges[ranges.length - 1] = { start: last.start, end: slot };
    else ranges.push({ start: slot, end: slot });
  }
  return ranges;
}

interface SlotStreamHost { capacity: number; count: number; streams: Set<SlotAlignedFloatStream>; }
const hosts = new WeakMap<object, SlotStreamHost>();

export function registerSlotStreamHost(owner: object, capacity: number, count = 0): void {
  hosts.set(owner, { capacity, count, streams: new Set() });
}
export function createHostSlotStream(owner: object, options: SlotAlignedFloatStreamOptions): SlotAlignedFloatStream {
  const host = requireHost(owner);
  const stream = new SlotAlignedFloatStream(options);
  stream.resize(host.capacity, host.count);
  for (let slot = 0; slot < host.count; slot++) stream.initializeSlot(slot);
  host.streams.add(stream);
  return stream;
}
export function notifySlotCreated(owner: object, slot: number): void {
  const host = requireHost(owner);
  host.count = Math.max(host.count, slot + 1);
  for (const stream of host.streams) stream.initializeSlot(slot);
}
export function notifySlotsSwapped(owner: object, a: number, b: number): void {
  for (const stream of requireHost(owner).streams) stream.swapSlots(a, b);
}
export function notifySlotsTruncated(owner: object, count: number): void {
  const host = requireHost(owner);
  host.count = count;
  for (const stream of host.streams) stream.truncate(count);
}
export function notifySlotCapacity(owner: object, capacity: number): void {
  const host = requireHost(owner);
  host.capacity = capacity;
  for (const stream of host.streams) stream.resize(capacity, host.count);
}
export function notifySlotsCleared(owner: object): void {
  const host = requireHost(owner);
  host.count = 0;
  for (const stream of host.streams) stream.clear();
}
export function disposeSlotStreamHost(owner: object): void {
  const host = hosts.get(owner);
  if (!host) return;
  for (const stream of host.streams) stream.dispose();
  host.streams.clear();
  hosts.delete(owner);
}
function requireHost(owner: object): SlotStreamHost {
  const host = hosts.get(owner);
  if (!host) throw new Error("Instance set is not registered as a slot-stream host.");
  return host;
}
