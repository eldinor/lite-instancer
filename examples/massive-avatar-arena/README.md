# Massive Avatar Arena

Open `/examples/massive-avatar-arena/` through `npm run dev`.

This scene combines four animated GLBs from `eldinor/ForBJS`:

- `avatar_3.glb` supplies the 2,000-capacity lightweight citizen crowd.
- `avatar_2.glb` supplies 360 multi-part alien VAT characters.
- `avatar_4.glb` supplies 140 detailed robot VAT characters.
- `avatar_5.glb` remains a full-quality live-skeleton hero with a pulsing outline.

The three crowd skeletons are baked independently, while a semantic clip map normalizes their differently named idle, walk, run, jump, kick, fall, and landing animations. The reaction control sends those actions outward as a radial wave. Population presets cycle through 100, 500, 1,000, 1,500, and 2,500 without rebuilding the pools. Packed `active-count` visibility keeps hidden capacity out of the vertex workload.

Click a crowd character to select it through logical screen-space picking. Use the camera control to alternate between the complete arena and the outlined hero.

## Performance capture

The panel reports rolling frame and playback-mutation p50/p95 values, GPU time, draw calls, and exact VAT adapter upload calls and payload bytes. The complete machine-readable snapshot is available as `globalThis.__liteInstancerBenchmark` in browser developer tools.

For comparable captures, select the same population, leave the arena camera stationary for ten seconds, trigger one reaction wave, and save the snapshot after the wave completes. Record the browser, operating system, GPU, backend, and geometry revision alongside the JSON. `cpuDirtyBytes` measures rewritten slots; `backendUploadCalls` and `backendBytesUploaded` measure the exact `setInstances()` payloads submitted by the Babylon Lite VAT adapters.

Use **benchmark 100 / 500 / 1,000 / 1,500 / 2,500** for an automatic comparison. Each population receives a 1.5-second warmup, a 3-second steady sample, and an 8.5-second reaction-wave sample. The panel shows each population's steady/reaction frame p95, playback edit count, and exact VAT upload volume. Reaction-wave playback changes are batched once per crowd pool per frame, and active-count sets upload only their visible prefixes. Full results—including frame, update, GPU, draw-call, mutation, heap, dirty-byte, allocation, and population-transition measurements—are written to `globalThis.__liteInstancerArenaBenchmark` and printed with `console.table`. Keep the tab focused and the arena camera unchanged while it runs.
