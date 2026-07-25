export type StageId = string;

export type StageState =
  | "loading"
  | "loaded"
  | "entering"
  | "active"
  | "exiting"
  | "disposing"
  | "disposed"
  | "failed";

export interface StageProgressUpdate {
  phase: string;
  completed: number;
  total?: number | null;
  message?: string;
}

export interface StageProgressEvent extends StageProgressUpdate {
  stageId: StageId;
  operationId: string;
  ratio: number | null;
}

export interface StageResourceScope {
  own<T>(value: T, dispose: (value: T) => void | Promise<void>): T;
}

export interface SharedResourceOptions<T> {
  dispose?: (value: T) => void | Promise<void>;
}

export interface SharedResourceScope {
  acquire<T>(
    key: string,
    factory: () => T | Promise<T>,
    options?: SharedResourceOptions<T>
  ): Promise<T>;
}

export interface StageLoadContext<TPayload = unknown> {
  signal: AbortSignal;
  payload: TPayload;
  reportProgress(update: StageProgressUpdate): void;
  resources: StageResourceScope;
  shared: SharedResourceScope;
}

export interface StageLoadResult<TData = unknown> {
  data: TData;
}

export interface StageLifecycleContext<TPayload = unknown> {
  signal: AbortSignal;
  payload: TPayload;
}

export interface StageDefinition<TPayload = unknown, TData = unknown> {
  id: StageId;
  load(context: StageLoadContext<TPayload>): StageLoadResult<TData> | Promise<StageLoadResult<TData>>;
  validate?(instance: StageInstance<TData>): void | Promise<void>;
  enter?(instance: StageInstance<TData>, context: StageLifecycleContext<TPayload>): void | Promise<void>;
  exit?(instance: StageInstance<TData>, context: StageLifecycleContext): void | Promise<void>;
  dispose?(instance: StageInstance<TData>): void | Promise<void>;
}

export interface StageInstance<TData = unknown> {
  readonly id: StageId;
  readonly definitionId: StageId;
  readonly data: TData | undefined;
  readonly state: StageState;
  readonly createdAt: number;
  readonly activatedAt: number | undefined;
}

export interface StageStateChangedEvent {
  stageId: StageId;
  previous: StageState | null;
  state: StageState;
}

export interface TransitionContext {
  from: StageInstance | null;
  to: StageInstance;
  signal: AbortSignal;
}

export interface StageTransition {
  prepare?(context: TransitionContext): void | Promise<void>;
  run?(context: TransitionContext): void | Promise<void>;
  cleanup?(context: TransitionContext): void | Promise<void>;
}

export interface StageManagerOptions {
  defaultTransition?: StageTransition;
}

export interface NavigateOptions<TPayload = unknown> {
  payload?: TPayload;
  transition?: StageTransition;
  signal?: AbortSignal;
}

export interface PreloadOptions<TPayload = unknown> {
  payload?: TPayload;
  signal?: AbortSignal;
}

export interface StageNavigationResult {
  from: StageId | null;
  to: StageId;
  committed: boolean;
  durationMs: number;
}

export interface StageNavigationOperation {
  readonly id: string;
  readonly promise: Promise<StageNavigationResult>;
  cancel(): void;
}

export interface SharedResourceSnapshot {
  key: string;
  references: number;
  status: "loading" | "ready";
}

export interface StageManagerSnapshot {
  activeStage: StageId | null;
  stages: ReadonlyArray<{ id: StageId; state: StageState }>;
  sharedResources: ReadonlyArray<SharedResourceSnapshot>;
  pendingOperation: string | null;
}

export interface StageManager {
  readonly activeStage: StageInstance | null;
  readonly disposed: boolean;
}
