# Babylon.js manual release checks

Run the standalone benchmark and lifecycle page from the repository root:

```sh
npm run dev:babylonjs:benchmark
```

Open the URL printed by Vite. The page is intentionally separate from the examples gallery. It uses short 100, 500, 1,000, and 1,500 population passes, compares automatic and conservative fixed bounds, reports bounds-refresh calls/time separately, disables camera controls while measuring, and provides a copyable JSON report. No Playwright is required.

Run the standalone VAT asset round-trip smoke check:

```sh
npm run dev:babylonjs:vat-asset-smoke
```

It compares runtime-baked instances with a bake → encode → decode → asset-loaded path, verifies deterministic payloads, clips, sockets, bounds, lifecycle behavior, no-resampling loading, and disposal, then produces a copyable JSON report. It is intentionally small and thermal-light. Add `?backend=webgpu` to the local URL to request WebGPU when supported; the default is WebGL. No Playwright is required.
