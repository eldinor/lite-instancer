import type { Mesh } from "@babylonjs/lite";
import { asManager, asTarget, createManager } from "./interaction-manager.js";
import type {
  InteractionEventType,
  InteractionListener,
  InteractionManager,
  InteractionManagerOptions,
  InteractionMeshFilter,
  InteractionTarget
} from "./types.js";

export type {
  ClickThreshold,
  ClickThresholds,
  InteractionErrorContext,
  InteractionEvent,
  InteractionEventType,
  InteractionListener,
  InteractionManager,
  InteractionManagerOptions,
  InteractionMeshFilter,
  InteractionPointerType,
  InteractionTarget
} from "./types.js";

export function createInteractionManager(options: InteractionManagerOptions): InteractionManager {
  return createManager(options);
}

export function disposeInteractionManager(manager: InteractionManager): void {
  asManager(manager).dispose();
}

export function registerMesh(manager: InteractionManager, mesh: Mesh): InteractionTarget {
  return asManager(manager).register(mesh) as unknown as InteractionTarget;
}

export function disposeInteractionTarget(target: InteractionTarget): void {
  const internal = asTarget(target);
  internal.manager.disposeTarget(internal);
}

export function onInteraction(
  target: InteractionTarget,
  type: InteractionEventType,
  listener: InteractionListener
): () => void {
  const internal = asTarget(target);
  if (!internal.active) throw new Error("The interaction target has been disposed.");
  return subscribe(internal.listeners, type, listener);
}

export function onInteractionEvent(
  manager: InteractionManager,
  type: InteractionEventType,
  listener: InteractionListener
): () => void {
  const internal = asManager(manager);
  if (internal.disposed) throw new Error("The interaction manager has been disposed.");
  return subscribe(internal.globalListeners, type, listener);
}

export function setInteractionEnabled(manager: InteractionManager, enabled: boolean): void {
  asManager(manager).setEnabled(enabled);
}

export function isInteractionEnabled(manager: InteractionManager): boolean {
  const internal = asManager(manager);
  return internal.enabled && !internal.disposed;
}

export function setInteractionFilter(manager: InteractionManager, filter: InteractionMeshFilter | null): void {
  asManager(manager).filter = filter;
}

export function getHoveredTarget(manager: InteractionManager): InteractionTarget | null {
  return (asManager(manager).hoverRecord?.target as unknown as InteractionTarget | undefined) ?? null;
}

export function getPressedTarget(manager: InteractionManager, pointerId: number): InteractionTarget | null {
  const session = asManager(manager).pointers.get(pointerId);
  if (!session?.rawDown || !session.downTarget?.active) return null;
  return session.downTarget as unknown as InteractionTarget;
}

export function getActivePointers(manager: InteractionManager): readonly number[] {
  return [...asManager(manager).pointers.keys()];
}

export function isTargetHovered(target: InteractionTarget): boolean {
  const internal = asTarget(target);
  return internal.active && internal.manager.hoverRecord?.target === internal;
}

export function isTargetPressed(target: InteractionTarget): boolean {
  const internal = asTarget(target);
  if (!internal.active) return false;
  for (const session of internal.manager.pointers.values()) {
    if (session.rawDown && session.downTarget === internal) return true;
  }
  return false;
}

function subscribe(
  listeners: Map<InteractionEventType, Set<InteractionListener>>,
  type: InteractionEventType,
  listener: InteractionListener
): () => void {
  let set = listeners.get(type);
  if (!set) {
    set = new Set();
    listeners.set(type, set);
  }
  set.add(listener);
  let active = true;
  return () => {
    if (!active) return;
    active = false;
    set?.delete(listener);
    if (set?.size === 0) listeners.delete(type);
  };
}

