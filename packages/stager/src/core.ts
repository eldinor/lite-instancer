import type {
  NavigateOptions,
  PreloadOptions,
  SharedResourceOptions,
  SharedResourceSnapshot,
  StageDefinition,
  StageId,
  StageInstance,
  StageLifecycleContext,
  StageManager,
  StageManagerOptions,
  StageManagerSnapshot,
  StageNavigationOperation,
  StageNavigationResult,
  StageProgressEvent,
  StageProgressUpdate,
  StageResourceScope,
  StageState,
  StageStateChangedEvent,
  StageTransition
} from "./types.js";

type AnyDefinition = StageDefinition<unknown, unknown>;
type StateListener = (event: StageStateChangedEvent) => void;
type ProgressListener = (event: StageProgressEvent) => void;

interface OwnedResource {
  value: unknown;
  dispose(value: unknown): void | Promise<void>;
}

interface SharedRecord {
  key: string;
  references: number;
  status: "loading" | "ready";
  promise: Promise<unknown>;
  value?: unknown;
  dispose?: (value: unknown) => void | Promise<void>;
}

interface InternalStage extends StageInstance {
  data: unknown;
  state: StageState;
  activatedAt: number | undefined;
  definition: AnyDefinition;
  owned: OwnedResource[];
  sharedKeys: string[];
  loadCompleted: boolean;
  lastPayload: unknown;
}

interface PendingOperation {
  id: string;
  controller: AbortController;
  settled: Promise<StageNavigationResult> | null;
}

interface InternalManager extends StageManager {
  activeStage: InternalStage | null;
  disposed: boolean;
  definitions: Map<StageId, AnyDefinition>;
  stages: Map<StageId, InternalStage>;
  shared: Map<string, SharedRecord>;
  stateListeners: Set<StateListener>;
  progressListeners: Set<ProgressListener>;
  defaultTransition: StageTransition;
  pending: PendingOperation | null;
  nextOperationId: number;
}

const legalTransitions: Readonly<Record<StageState, readonly StageState[]>> = {
  loading: ["loaded", "failed", "disposing"],
  loaded: ["entering", "disposing"],
  entering: ["active", "failed", "disposing"],
  active: ["exiting", "disposing"],
  exiting: ["loaded", "failed", "disposing"],
  disposing: ["disposed"],
  disposed: [],
  failed: ["disposing"]
};

export class StageAbortError extends Error {
  constructor(message = "The stage operation was aborted.") {
    super(message);
    this.name = "AbortError";
  }
}

export function isStageAbortError(error: unknown): error is StageAbortError {
  return error instanceof Error && error.name === "AbortError";
}

export function createStageManager(options: StageManagerOptions = {}): StageManager {
  const manager: InternalManager = {
    activeStage: null,
    disposed: false,
    definitions: new Map(),
    stages: new Map(),
    shared: new Map(),
    stateListeners: new Set(),
    progressListeners: new Set(),
    defaultTransition: options.defaultTransition ?? instantTransition(),
    pending: null,
    nextOperationId: 1
  };
  return manager;
}

export function defineStage<TPayload, TData>(
  manager: StageManager,
  definition: StageDefinition<TPayload, TData>
): void {
  const internal = asManager(manager);
  assertUsable(internal);
  if (!definition.id) throw new Error("A stage definition requires a non-empty id.");
  if (internal.definitions.has(definition.id)) {
    throw new Error(`Stage "${definition.id}" is already defined.`);
  }
  internal.definitions.set(definition.id, definition as AnyDefinition);
}

export function getActiveStage(manager: StageManager): StageInstance | null {
  return asManager(manager).activeStage;
}

export function getStageInstance(manager: StageManager, stageId: StageId): StageInstance | null {
  return asManager(manager).stages.get(stageId) ?? null;
}

export function getStageManagerSnapshot(manager: StageManager): StageManagerSnapshot {
  const internal = asManager(manager);
  return {
    activeStage: internal.activeStage?.id ?? null,
    stages: [...internal.stages.values()].map((stage) => ({ id: stage.id, state: stage.state })),
    sharedResources: [...internal.shared.values()].map(toSharedSnapshot),
    pendingOperation: internal.pending?.id ?? null
  };
}

export function onStageStateChanged(manager: StageManager, listener: StateListener): () => void {
  const internal = asManager(manager);
  assertUsable(internal);
  return subscribe(internal.stateListeners, listener);
}

export function onStageProgress(manager: StageManager, listener: ProgressListener): () => void {
  const internal = asManager(manager);
  assertUsable(internal);
  return subscribe(internal.progressListeners, listener);
}

export function instantTransition(): StageTransition {
  return Object.freeze({});
}

export function beginStageNavigation<TPayload>(
  manager: StageManager,
  stageId: StageId,
  options: NavigateOptions<TPayload> = {}
): StageNavigationOperation {
  const internal = asManager(manager);
  assertUsable(internal);
  return beginOperation(internal, stageId, options, true);
}

export function navigateToStage<TPayload>(
  manager: StageManager,
  stageId: StageId,
  options: NavigateOptions<TPayload> = {}
): Promise<StageNavigationResult> {
  return beginStageNavigation(manager, stageId, options).promise;
}

export function preloadStage<TPayload>(
  manager: StageManager,
  stageId: StageId,
  options: PreloadOptions<TPayload> = {}
): Promise<StageInstance> {
  const internal = asManager(manager);
  assertUsable(internal);
  const operation = beginOperation(internal, stageId, options, false);
  return operation.promise.then(() => {
    const stage = internal.stages.get(stageId);
    if (!stage) throw new Error(`Stage "${stageId}" was not retained after preloading.`);
    return stage;
  });
}

export function activateStage<TPayload>(
  manager: StageManager,
  stageId: StageId,
  options: NavigateOptions<TPayload> = {}
): Promise<StageNavigationResult> {
  const internal = asManager(manager);
  const stage = internal.stages.get(stageId);
  if (!stage || stage.state !== "loaded") {
    return Promise.reject(new Error(`Stage "${stageId}" must be preloaded before activation.`));
  }
  return beginStageNavigation(manager, stageId, options).promise;
}

export async function disposeStage(manager: StageManager, stageId: StageId): Promise<void> {
  const internal = asManager(manager);
  assertUsable(internal);
  if (internal.activeStage?.id === stageId) {
    throw new Error(`Cannot dispose active stage "${stageId}".`);
  }
  const stage = internal.stages.get(stageId);
  if (stage) await disposeInternalStage(internal, stage);
}

export async function disposeStageManager(manager: StageManager): Promise<void> {
  const internal = asManager(manager);
  if (internal.disposed) return;
  internal.disposed = true;
  const errors: unknown[] = [];
  const pending = internal.pending;
  pending?.controller.abort();
  if (pending?.settled) {
    try {
      await pending.settled;
    } catch (error) {
      if (!isStageAbortError(error)) errors.push(error);
    }
  }
  for (const stage of [...internal.stages.values()].reverse()) {
    try {
      await disposeInternalStage(internal, stage);
    } catch (error) {
      errors.push(error);
    }
  }
  for (const record of [...internal.shared.values()]) {
    try {
      await disposeSharedRecord(internal, record, true);
    } catch (error) {
      errors.push(error);
    }
  }
  internal.activeStage = null;
  internal.pending = null;
  internal.stateListeners.clear();
  internal.progressListeners.clear();
  if (errors.length > 0) throw new AggregateError(errors, "Stage manager disposal failed.");
}

function beginOperation<TPayload>(
  manager: InternalManager,
  stageId: StageId,
  options: NavigateOptions<TPayload> | PreloadOptions<TPayload>,
  activate: boolean
): StageNavigationOperation {
  const id = `stage-operation-${manager.nextOperationId++}`;
  manager.pending?.controller.abort();
  const controller = new AbortController();
  const pending: PendingOperation = { id, controller, settled: null };
  manager.pending = pending;

  let removeExternalAbort = (): void => undefined;
  if (options.signal) {
    if (options.signal.aborted) controller.abort();
    else {
      const abort = (): void => controller.abort();
      options.signal.addEventListener("abort", abort, { once: true });
      removeExternalAbort = () => options.signal?.removeEventListener("abort", abort);
    }
  }

  const startedAt = performance.now();
  const promise = runOperation(
    manager,
    pending,
    stageId,
    options.payload,
    "transition" in options ? options.transition : undefined,
    activate,
    startedAt
  ).finally(() => {
    removeExternalAbort();
    if (manager.pending === pending) manager.pending = null;
  });
  pending.settled = promise;

  return {
    id,
    promise,
    cancel: () => controller.abort()
  };
}

async function runOperation(
  manager: InternalManager,
  operation: PendingOperation,
  stageId: StageId,
  payload: unknown,
  transitionOverride: StageTransition | undefined,
  activate: boolean,
  startedAt: number
): Promise<StageNavigationResult> {
  const definition = manager.definitions.get(stageId);
  if (!definition) throw new Error(`Unknown stage "${stageId}".`);
  assertCurrent(manager, operation);

  const from = manager.activeStage;
  if (activate && from?.id === stageId) {
    return navigationResult(from.id, stageId, true, startedAt);
  }

  let target = manager.stages.get(stageId);
  if (!target) {
    target = createInternalStage(definition);
    manager.stages.set(stageId, target);
    emitState(manager, target, null, "loading");
    try {
      await loadStage(manager, target, operation, payload);
    } catch (error) {
      if (!isStageAbortError(error)) setState(manager, target, "failed");
      await disposeInternalStage(manager, target);
      throw normalizeAbort(error, operation.controller.signal);
    }
  } else if (target.state !== "loaded") {
    throw new Error(`Stage "${stageId}" is ${target.state} and cannot be reused.`);
  }

  assertCurrent(manager, operation);
  if (!activate) return navigationResult(from?.id ?? null, stageId, false, startedAt);

  const transition = transitionOverride ?? manager.defaultTransition;
  const context = { from, to: target, signal: operation.controller.signal };
  let prepared = false;
  try {
    if (transition.prepare) {
      prepared = true;
      await transition.prepare(context);
      assertCurrent(manager, operation);
    }
    setState(manager, target, "entering");
    await target.definition.enter?.(
      target,
      lifecycleContext(operation.controller.signal, payload)
    );
    assertCurrent(manager, operation);
    setState(manager, target, "active");
    target.activatedAt = Date.now();
    manager.activeStage = target;

    if (from && from !== target) {
      setState(manager, from, "exiting");
      await from.definition.exit?.(from, lifecycleContext(operation.controller.signal, undefined));
      setState(manager, from, "loaded");
    }
    if (transition.run) await transition.run(context);
    assertCurrent(manager, operation);
    return navigationResult(from?.id ?? null, stageId, true, startedAt);
  } catch (error) {
    if (manager.activeStage !== target) {
      if (!isStageAbortError(error) && target.state !== "failed") setState(manager, target, "failed");
      await disposeInternalStage(manager, target);
    }
    throw normalizeAbort(error, operation.controller.signal);
  } finally {
    if (prepared || transition.cleanup) {
      await transition.cleanup?.(context);
    }
  }
}

async function loadStage(
  manager: InternalManager,
  stage: InternalStage,
  operation: PendingOperation,
  payload: unknown
): Promise<void> {
  const resources = createOwnedScope(stage);
  const shared = createSharedScope(manager, stage, operation);
  const reportProgress = (update: StageProgressUpdate): void => {
    if (operation.controller.signal.aborted || manager.pending !== operation) return;
    validateProgress(update);
    const total = update.total ?? null;
    const ratio = total === null || total === 0 ? null : clamp(update.completed / total, 0, 1);
    const event: StageProgressEvent = {
      stageId: stage.id,
      operationId: operation.id,
      phase: update.phase,
      completed: update.completed,
      total,
      ratio
    };
    if (update.message !== undefined) event.message = update.message;
    for (const listener of manager.progressListeners) listener(event);
  };

  stage.lastPayload = payload;
  const result = await stage.definition.load({
    signal: operation.controller.signal,
    payload,
    reportProgress,
    resources,
    shared
  });
  assertCurrent(manager, operation);
  stage.data = result.data;
  stage.loadCompleted = true;
  await stage.definition.validate?.(stage);
  assertCurrent(manager, operation);
  setState(manager, stage, "loaded");
}

function createInternalStage(definition: AnyDefinition): InternalStage {
  return {
    id: definition.id,
    definitionId: definition.id,
    data: undefined,
    state: "loading",
    createdAt: Date.now(),
    activatedAt: undefined,
    definition,
    owned: [],
    sharedKeys: [],
    loadCompleted: false,
    lastPayload: undefined
  };
}

function createOwnedScope(stage: InternalStage): StageResourceScope {
  return {
    own<T>(value: T, dispose: (value: T) => void | Promise<void>): T {
      stage.owned.push({
        value,
        dispose: dispose as (value: unknown) => void | Promise<void>
      });
      return value;
    }
  };
}

function createSharedScope(
  manager: InternalManager,
  stage: InternalStage,
  operation: PendingOperation
) {
  return {
    async acquire<T>(
      key: string,
      factory: () => T | Promise<T>,
      options: SharedResourceOptions<T> = {}
    ): Promise<T> {
      assertCurrent(manager, operation);
      let record = manager.shared.get(key);
      if (!record) {
        const promise = Promise.resolve().then(factory);
        record = {
          key,
          references: 0,
          status: "loading",
          promise,
          ...(options.dispose
            ? { dispose: options.dispose as (value: unknown) => void | Promise<void> }
            : {})
        };
        manager.shared.set(key, record);
        promise.then(
          (value) => {
            record!.value = value;
            record!.status = "ready";
          },
          () => {
            if (manager.shared.get(key) === record) manager.shared.delete(key);
          }
        );
      }
      const value = (await record.promise) as T;
      assertCurrent(manager, operation);
      record.references++;
      stage.sharedKeys.push(key);
      return value;
    }
  };
}

async function disposeInternalStage(manager: InternalManager, stage: InternalStage): Promise<void> {
  if (stage.state === "disposed" || stage.state === "disposing") return;
  setState(manager, stage, "disposing");
  const errors: unknown[] = [];
  if (stage.loadCompleted) {
    try {
      await stage.definition.dispose?.(stage);
    } catch (error) {
      errors.push(error);
    }
  }
  for (const resource of stage.owned.reverse()) {
    try {
      await resource.dispose(resource.value);
    } catch (error) {
      errors.push(error);
    }
  }
  stage.owned.length = 0;
  for (const key of stage.sharedKeys.reverse()) {
    const record = manager.shared.get(key);
    if (!record) continue;
    record.references = Math.max(0, record.references - 1);
    if (record.references === 0) {
      try {
        await disposeSharedRecord(manager, record, false);
      } catch (error) {
        errors.push(error);
      }
    }
  }
  stage.sharedKeys.length = 0;
  if (manager.activeStage === stage) manager.activeStage = null;
  manager.stages.delete(stage.id);
  setState(manager, stage, "disposed");
  if (errors.length > 0) throw new AggregateError(errors, `Disposal of stage "${stage.id}" failed.`);
}

async function disposeSharedRecord(
  manager: InternalManager,
  record: SharedRecord,
  force: boolean
): Promise<void> {
  if (!force && record.references > 0) return;
  manager.shared.delete(record.key);
  const value = record.status === "ready" ? record.value : await record.promise;
  if (record.dispose && value !== undefined) await record.dispose(value);
}

function setState(manager: InternalManager, stage: InternalStage, next: StageState): void {
  if (stage.state === next) return;
  if (!legalTransitions[stage.state].includes(next)) {
    throw new Error(`Invalid stage transition for "${stage.id}": ${stage.state} -> ${next}.`);
  }
  const previous = stage.state;
  stage.state = next;
  emitState(manager, stage, previous, next);
}

function emitState(
  manager: InternalManager,
  stage: InternalStage,
  previous: StageState | null,
  state: StageState
): void {
  const event = { stageId: stage.id, previous, state };
  for (const listener of manager.stateListeners) listener(event);
}

function assertCurrent(manager: InternalManager, operation: PendingOperation): void {
  if (operation.controller.signal.aborted || manager.pending !== operation || manager.disposed) {
    throw new StageAbortError();
  }
}

function assertUsable(manager: InternalManager): void {
  if (manager.disposed) throw new Error("The stage manager has been disposed.");
}

function asManager(manager: StageManager): InternalManager {
  return manager as InternalManager;
}

function lifecycleContext(signal: AbortSignal, payload: unknown): StageLifecycleContext {
  return { signal, payload };
}

function normalizeAbort(error: unknown, signal: AbortSignal): unknown {
  return signal.aborted && !isStageAbortError(error) ? new StageAbortError() : error;
}

function navigationResult(
  from: StageId | null,
  to: StageId,
  committed: boolean,
  startedAt: number
): StageNavigationResult {
  return {
    from,
    to,
    committed,
    durationMs: performance.now() - startedAt
  };
}

function validateProgress(update: StageProgressUpdate): void {
  if (!update.phase) throw new Error("Progress updates require a phase.");
  if (!Number.isFinite(update.completed) || update.completed < 0) {
    throw new Error("Progress completed must be a finite non-negative number.");
  }
  if (
    update.total !== undefined &&
    update.total !== null &&
    (!Number.isFinite(update.total) || update.total < 0)
  ) {
    throw new Error("Progress total must be null or a finite non-negative number.");
  }
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function toSharedSnapshot(record: SharedRecord): SharedResourceSnapshot {
  return {
    key: record.key,
    references: record.references,
    status: record.status
  };
}

function subscribe<T>(listeners: Set<(event: T) => void>, listener: (event: T) => void): () => void {
  listeners.add(listener);
  let active = true;
  return () => {
    if (!active) return;
    active = false;
    listeners.delete(listener);
  };
}
