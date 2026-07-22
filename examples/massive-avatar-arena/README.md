# Massive Avatar Arena

Open `/examples/massive-avatar-arena/` through `npm run dev`.

This scene combines four animated GLBs from `eldinor/ForBJS`:

- `avatar_3.glb` supplies the 2,000-capacity lightweight citizen crowd.
- `avatar_2.glb` supplies 360 multi-part alien VAT characters.
- `avatar_4.glb` supplies 140 detailed robot VAT characters.
- `avatar_5.glb` remains a full-quality live-skeleton hero with a pulsing outline.

The three crowd skeletons are baked independently, while a semantic clip map normalizes their differently named idle, walk, run, jump, kick, fall, and landing animations. The reaction control sends those actions outward as a radial wave. Population presets cycle through 100, 500, 1,000, 1,500, 2,000, and 2,500 without rebuilding the pools. Packed `active-count` visibility keeps hidden capacity out of the vertex workload.

Click a crowd character to select it through logical screen-space picking. Use the camera control to alternate between the complete arena and the outlined hero.

## Performance capture

The panel reports rolling frame and playback-mutation p50/p95 values, GPU time, draw calls, and exact VAT adapter upload calls and payload bytes. The complete machine-readable snapshot is available as `globalThis.__liteInstancerBenchmark` in browser developer tools.

For comparable captures, select the same population, leave the arena camera stationary for ten seconds, trigger one reaction wave, and save the snapshot after the wave completes. Record the browser, operating system, GPU, backend, and geometry revision alongside the JSON. `cpuDirtyBytes` measures rewritten slots; `backendUploadCalls` and `backendBytesUploaded` measure the exact `setInstances()` payloads submitted by the Babylon Lite VAT adapters.

Use the separate right-side **Benchmark** panel to run the default quick 100 / 500 / 1,000 / 1,500 comparison. The manual population control still supports 2,000 and 2,500, but automatic runs deliberately exclude them. The quick benchmark measures a dedicated 100-avatar recovery baseline and makes one ascending pass. Before each population there is a 0.75-second cooldown and 0.5-second warmup, followed by a 1-second steady sample and a 3-second accelerated reaction-wave sample. After every intermediate sample above 100, the arena returns to 100 and checks rolling 1-second GPU p95 windows after a 1-second settle. If GPU p95 does not return within 10% of baseline before the 15-second limit, the benchmark stops immediately, returns to 100 avatars, and preserves a partial report. Camera controls are disabled for the whole measurement and restored on completion or stop. The benchmark button changes to **stop benchmark** during a run, and a prominent top-center status shows the current phase.

GPU timestamps use Babylon Lite's public `isGpuTimingSupported()` and `setGpuTimingEnabled()` APIs. Supported devices report measured GPU p95 after asynchronous samples arrive; unsupported adapters are labeled explicitly. Geometry workload uses the public `getMeshGeometry()` boundary added in Babylon Lite 1.13. Reaction-wave playback changes are batched once per crowd pool per frame, and active-count sets upload only their visible prefixes. Quick results are explicitly labeled as single samples with repeatability not measured. A separately labeled optional stress benchmark runs ascending and descending passes and should only be used after the machine has cooled; its medians are marked unreliable when frame or GPU drift exceeds 15%. Raw passes and every recovery attempt remain in the copied report. Full or partial results are written to `globalThis.__liteInstancerArenaBenchmark`, printed with `console.table`, and can be copied as formatted JSON with **copy report**.
