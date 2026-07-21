import { createVatBakeWorkerPool, installVatBakeWorker, type LiteVatSampledMatrices } from "../src/vat-preprocess.js";

class FakeWorker extends EventTarget implements Pick<Worker, "addEventListener" | "postMessage" | "terminate"> {
  terminated = false;
  postMessage(message: unknown): void {
    const scope = {
      onmessage: null as ((event: MessageEvent) => void) | null,
      postMessage: (response: unknown) => this.dispatchEvent(new MessageEvent("message", { data: response }))
    };
    installVatBakeWorker(scope);
    queueMicrotask(() => scope.onmessage?.(new MessageEvent("message", { data: message })));
  }
  terminate(): void {
    this.terminated = true;
  }
}

function input(): LiteVatSampledMatrices {
  return {
    boneCount: 1,
    clips: { Idle: { fromRow: 0, frameCount: 1, fps: 30 } },
    frameData: new Float32Array(16)
  };
}

describe("VAT preprocessing worker pool", () => {
  it("queues neutral matrix packing and reports progress", async () => {
    const progress = vi.fn();
    const pool = createVatBakeWorkerPool({ workerFactory: () => new FakeWorker() as unknown as Worker, concurrency: 1 });
    const asset = await pool.bake(input(), { onProgress: progress, transferInput: false });
    expect(asset.encoding).toBe("lite-matrix-rgba32float");
    expect(progress).toHaveBeenCalledWith({ completed: 0, total: 1 });
    pool.dispose();
  });

  it("rejects queued work after disposal", async () => {
    const pool = createVatBakeWorkerPool({ workerFactory: () => new FakeWorker() as unknown as Worker });
    pool.dispose();
    await expect(pool.bake(input())).rejects.toThrow(/disposed/i);
  });
});
