import {
  attachControl,
  attachFreeControl,
  attachGeospatialControls,
  disposeScene,
  registerScene,
  unregisterScene,
  type ArcRotateCamera,
  type AttachControlOptions,
  type FreeCamera,
  type GeospatialCamera,
  type GeospatialControlOptions,
  type SceneContext
} from "@babylonjs/lite";
import { defineStage } from "./core.js";
import type {
  StageDefinition,
  StageInstance,
  StageLifecycleContext,
  StageLoadContext,
  StageManager
} from "./types.js";

export interface BabylonCameraControls {
  attach(canvas: HTMLCanvasElement, scene: SceneContext): () => void;
}

export interface BabylonStageHostOptions {
  canvas: HTMLCanvasElement;
}

export interface BabylonStageHost {
  readonly canvas: HTMLCanvasElement;
}

export interface BabylonStageLoadResult<TData = unknown> {
  scene: SceneContext;
  data: TData;
  controls?: BabylonCameraControls;
}

export interface BabylonStageDefinition<TPayload = unknown, TData = unknown> {
  id: string;
  load(
    context: StageLoadContext<TPayload>
  ): BabylonStageLoadResult<TData> | Promise<BabylonStageLoadResult<TData>>;
  validate?(instance: StageInstance<TData>): void | Promise<void>;
  enter?(instance: StageInstance<TData>, context: StageLifecycleContext<TPayload>): void | Promise<void>;
  exit?(instance: StageInstance<TData>, context: StageLifecycleContext): void | Promise<void>;
  dispose?(instance: StageInstance<TData>): void | Promise<void>;
}

interface BabylonStageRuntime {
  scene: SceneContext;
  controls: BabylonCameraControls | undefined;
  detachControls: (() => void) | null;
}

interface InternalBabylonStageHost extends BabylonStageHost {
  active: BabylonStageRuntime | null;
}

export function createBabylonStageHost(options: BabylonStageHostOptions): BabylonStageHost {
  return {
    canvas: options.canvas,
    active: null
  } as InternalBabylonStageHost;
}

export function defineBabylonStage<TPayload, TData>(
  manager: StageManager,
  host: BabylonStageHost,
  definition: BabylonStageDefinition<TPayload, TData>
): void {
  const internalHost = asHost(host);
  let runtime: BabylonStageRuntime | null = null;

  const wrapped: StageDefinition<TPayload, TData> = {
    id: definition.id,
    async load(context) {
      const result = await definition.load(context);
      runtime = {
        scene: result.scene,
        controls: result.controls,
        detachControls: null
      };
      context.resources.own(result.scene, disposeScene);
      return { data: result.data };
    },
    validate(instance) {
      return definition.validate?.(instance);
    },
    async enter(instance, context) {
      const current = requireRuntime(runtime, definition.id);
      const previous = await activateRuntime(internalHost, current);
      try {
        await definition.enter?.(instance, context);
      } catch (error) {
        await rollbackRuntime(
          internalHost,
          current,
          previous,
          error,
          `Enter of Babylon stage "${definition.id}" failed and rollback was incomplete.`
        );
      }
    },
    async exit(instance, context) {
      const errors: unknown[] = [];
      try {
        await definition.exit?.(instance, context);
      } catch (error) {
        errors.push(error);
      }
      if (runtime) {
        try {
          await deactivateRuntime(internalHost, runtime);
        } catch (error) {
          errors.push(error);
        }
      }
      throwCollected(errors, `Exit of Babylon stage "${definition.id}" failed.`);
    },
    async dispose(instance) {
      const errors: unknown[] = [];
      try {
        await definition.dispose?.(instance);
      } catch (error) {
        errors.push(error);
      }
      if (runtime) {
        try {
          await deactivateRuntime(internalHost, runtime);
        } catch (error) {
          errors.push(error);
        }
      }
      runtime = null;
      throwCollected(errors, `Disposal of Babylon stage "${definition.id}" failed.`);
    }
  };

  defineStage(manager, wrapped);
}

export function arcRotateCameraControls(
  camera: ArcRotateCamera,
  options?: AttachControlOptions
): BabylonCameraControls {
  return {
    attach(canvas, scene) {
      return attachControl(camera, canvas, scene, options);
    }
  };
}

export function freeCameraControls(camera: FreeCamera): BabylonCameraControls {
  return {
    attach(canvas, scene) {
      return attachFreeControl(camera, canvas, scene);
    }
  };
}

export function geospatialCameraControls(
  camera: GeospatialCamera,
  options?: GeospatialControlOptions
): BabylonCameraControls {
  return {
    attach(canvas, scene) {
      return attachGeospatialControls(camera, canvas, scene, options);
    }
  };
}

async function activateRuntime(
  host: InternalBabylonStageHost,
  runtime: BabylonStageRuntime
): Promise<BabylonStageRuntime | null> {
  if (host.active === runtime) return null;
  const previous = host.active;
  if (previous) await deactivateRuntime(host, previous);

  try {
    await registerRuntime(host, runtime);
  } catch (error) {
    await rollbackRuntime(
      host,
      runtime,
      previous,
      error,
      "Babylon scene activation failed and rollback was incomplete."
    );
  }
  return previous;
}

async function deactivateRuntime(
  host: InternalBabylonStageHost,
  runtime: BabylonStageRuntime
): Promise<void> {
  if (host.active !== runtime) return;
  host.active = null;
  const errors: unknown[] = [];
  try {
    runtime.detachControls?.();
  } catch (error) {
    errors.push(error);
  } finally {
    runtime.detachControls = null;
  }
  try {
    unregisterScene(runtime.scene);
  } catch (error) {
    errors.push(error);
  }
  throwCollected(errors, "Babylon scene deactivation failed.");
}

async function registerRuntime(
  host: InternalBabylonStageHost,
  runtime: BabylonStageRuntime
): Promise<void> {
  await registerScene(runtime.scene);
  try {
    runtime.detachControls = runtime.controls?.attach(host.canvas, runtime.scene) ?? null;
    host.active = runtime;
  } catch (error) {
    const errors = [error];
    runtime.detachControls = null;
    try {
      unregisterScene(runtime.scene);
    } catch (cleanupError) {
      errors.push(cleanupError);
    }
    throwCollected(errors, "Babylon camera-control attachment failed.");
  }
}

async function rollbackRuntime(
  host: InternalBabylonStageHost,
  failed: BabylonStageRuntime,
  previous: BabylonStageRuntime | null,
  cause: unknown,
  message: string
): Promise<never> {
  const errors = [cause];
  if (host.active === failed) {
    try {
      await deactivateRuntime(host, failed);
    } catch (error) {
      errors.push(error);
    }
  }
  if (previous && host.active !== previous) {
    try {
      await registerRuntime(host, previous);
    } catch (error) {
      errors.push(error);
    }
  }
  if (errors.length === 1) throw cause;
  throw new AggregateError(errors, message);
}

function requireRuntime(
  runtime: BabylonStageRuntime | null,
  stageId: string
): BabylonStageRuntime {
  if (!runtime) throw new Error(`Babylon stage "${stageId}" has no loaded scene.`);
  return runtime;
}

function asHost(host: BabylonStageHost): InternalBabylonStageHost {
  return host as InternalBabylonStageHost;
}

function throwCollected(errors: unknown[], message: string): void {
  if (errors.length === 1) throw errors[0];
  if (errors.length > 1) throw new AggregateError(errors, message);
}
