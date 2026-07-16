import { attachVat, type EngineContext, type Mesh, type VatHandle } from "@babylonjs/lite";

interface MutableSkeletonGpuData {
  boneTexture: GPUTexture;
  _refCount?: number;
}

interface EngineWithDevice extends EngineContext {
  _device: GPUDevice;
}

/**
 * Attach a VAT bake without destroying a skeleton texture that still has queued
 * `writeTexture` commands. Babylon Lite's `attachVat()` releases that texture
 * immediately; WebGPU validation rejects the later submission. This temporary
 * bridge retains the shared skeleton and releases its real bone texture after
 * all synchronous VAT bakes in the current task have been submitted.
 */
export function attachVatSafely(engine: EngineContext, mesh: Mesh, baked: Parameters<typeof attachVat>[2], clip?: string): VatHandle {
  const skeleton = mesh.skeleton as unknown as MutableSkeletonGpuData | null;
  if (!skeleton) {
    return attachVat(engine, mesh, baked, clip);
  }

  const runtime = engine as EngineWithDevice;
  const writtenTexture = skeleton.boneTexture;
  // Equivalent to Lite's internal `retain(skeleton)`. Every primitive of a
  // multi-mesh rig shares this object, so replacing its texture is unsafe.
  skeleton._refCount = (skeleton._refCount ?? 1) + 1;
  const handle = attachVat(engine, mesh, baked, clip);
  disposeAfterCurrentVatBakes(runtime._device, writtenTexture);
  return handle;
}

const pendingTextureDisposals = new WeakSet<GPUTexture>();

function disposeAfterCurrentVatBakes(device: GPUDevice, texture: GPUTexture): void {
  if (pendingTextureDisposals.has(texture)) {
    return;
  }
  pendingTextureDisposals.add(texture);
  queueMicrotask(() => {
    // All mesh primitives are baked synchronously before this microtask runs.
    // The empty submit puts their queued writeTexture calls on the GPU timeline.
    device.queue.submit([]);
    void device.queue.onSubmittedWorkDone().then(() => texture.destroy()).catch(() => undefined);
  });
}
