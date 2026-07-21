import type { InstanceId } from "./types.js";
import type { VatInstanceSet } from "./vat-instance-set.js";

export type InstanceControlDescriptor =
  | { readonly type: "boolean"; readonly label?: string; readonly description?: string; readonly group?: string }
  | { readonly type: "number"; readonly label?: string; readonly description?: string; readonly group?: string; readonly min?: number; readonly max?: number; readonly step?: number }
  | { readonly type: "enum"; readonly label?: string; readonly description?: string; readonly group?: string; readonly values: readonly string[] }
  | { readonly type: "color"; readonly label?: string; readonly description?: string; readonly group?: string }
  | { readonly type: "socket"; readonly label?: string; readonly description?: string; readonly group?: string; readonly values: readonly string[] };

export type InstanceControlMap = Readonly<Record<string, InstanceControlDescriptor>>;

/** Validate and freeze inspector-facing metadata without importing an editor framework. */
export function defineInstanceControls<T extends InstanceControlMap>(controls: T): T {
  for (const [name, descriptor] of Object.entries(controls)) {
    if (!name) throw new Error("Instance control names cannot be empty.");
    if (descriptor.type === "enum" || descriptor.type === "socket") {
      if (descriptor.values.length === 0 || new Set(descriptor.values).size !== descriptor.values.length) {
        throw new Error(`Instance control '${name}' requires unique non-empty choices.`);
      }
    }
    if (descriptor.type === "number") {
      if (descriptor.min !== undefined && descriptor.max !== undefined && descriptor.min > descriptor.max) {
        throw new Error(`Instance control '${name}' has min greater than max.`);
      }
      if (descriptor.step !== undefined && (!Number.isFinite(descriptor.step) || descriptor.step <= 0)) {
        throw new Error(`Instance control '${name}' requires a positive finite step.`);
      }
    }
    Object.freeze(descriptor);
  }
  return Object.freeze(controls);
}

export interface VatControlOptions {
  readonly sockets?: readonly string[];
  readonly equipment?: readonly string[];
  readonly maxSpeed?: number;
}

/** Standard descriptor facade used by Babylon Lite Explorer integrations. */
export function defineVatInstanceControls<TMetadata>(
  set: VatInstanceSet<TMetadata>,
  options: VatControlOptions = {}
): InstanceControlMap {
  return defineInstanceControls({
    clip: { type: "enum", label: "Clip", group: "Animation", values: Object.keys(set.clips) },
    speed: { type: "number", label: "FPS", group: "Animation", min: 0, max: options.maxSpeed ?? 120, step: 0.5 },
    phase: { type: "number", label: "Phase", group: "Animation", step: 0.01 },
    visible: { type: "boolean", label: "Visible", group: "Instance" },
    tint: { type: "color", label: "Tint", group: "Appearance" },
    ...(options.equipment?.length ? { equipment: { type: "enum" as const, label: "Equipment", group: "Appearance", values: options.equipment } } : {}),
    ...(options.sockets?.length ? { socket: { type: "socket" as const, label: "Socket", group: "Attachment", values: options.sockets } } : {})
  });
}

/** Small adapter surface that an Explorer can call without learning packed slot data. */
export interface VatInstanceControlAdapter {
  readonly controls: InstanceControlMap;
  get(id: InstanceId, control: "clip" | "speed" | "phase" | "visible" | "tint"): unknown;
  set(id: InstanceId, control: "clip" | "speed" | "phase" | "visible" | "tint", value: unknown): boolean;
}

export function createVatInstanceControlAdapter<TMetadata>(
  set: VatInstanceSet<TMetadata>,
  options: VatControlOptions = {}
): VatInstanceControlAdapter {
  return {
    controls: defineVatInstanceControls(set, options),
    get(id, control) {
      if (!set.has(id)) return undefined;
      if (control === "clip") return set.getClip(id);
      if (control === "visible") return set.getVisible(id);
      if (control === "tint") return set.getColor(id);
      const sample = set.getPlaybackSample(id);
      return control === "speed" ? sample?.fps : sample?.offsetSeconds;
    },
    set(id, control, value) {
      if (!set.has(id)) return false;
      if (control === "clip") return typeof value === "string" && set.setClip(id, value);
      if (control === "visible") {
        if (typeof value !== "boolean") return false;
        set.setVisible(id, value);
        return true;
      }
      if (control === "speed") {
        if (typeof value !== "number" || !Number.isFinite(value) || value < 0) return false;
        set.setFps(id, value);
        return true;
      }
      if (control === "phase") {
        if (typeof value !== "number" || !Number.isFinite(value)) return false;
        set.setPhaseOffset(id, value);
        return true;
      }
      if (!isColor(value)) return false;
      set.setColor(id, value);
      return true;
    }
  };
}

function isColor(value: unknown): value is readonly [number, number, number, number] {
  return Array.isArray(value) && value.length === 4 && value.every((component) => typeof component === "number" && Number.isFinite(component));
}
