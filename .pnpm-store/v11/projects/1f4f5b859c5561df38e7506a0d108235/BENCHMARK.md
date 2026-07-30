# Annotator benchmarks

All benchmarks are manual browser demos in the unified Annotator gallery. Run
them locally with:

```sh
npm run dev:annotator
```

Results are machine-specific. Compare repeated runs on target hardware and
match workload versions before treating differences as regressions.

## GPU label suite

The label suite has quick and three-round thorough profiles across static,
moving, numeric-text, collision, z-bucket, nine-slice, rounded-card, and
stable-live-count appearance-churn workloads through 1,000 labels. Its JSON
report includes p50/p95/p99 CPU timings, frame cadence, dropped-frame counts,
renderer statistics, fast-path counters, cache/atlas diagnostics, and
correctness checksums.

The appearance-churn case rotates 160 label visual styles while keeping 500
labels alive. It exercises parsed-color and nine-slice frame-cache limits,
reference protection, atlas growth, evictions, and capacity misses. Workload
version 3 adds this case and the cache fields.

A workload-version 2 thorough reference run used Chrome 150 on Windows, DPR 1,
a 1920 x 953 viewport, 45 warm-up frames, and three 240-frame measured rounds.
The values below average the three per-round summaries:

| 500-label workload | Update mean | Update p95 | Result |
| --- | ---: | ---: | --- |
| Numeric churn, original | 46.295 ms | 47.933 ms | 720/720 samples over 16.7 ms |
| Numeric churn, slot patch only | 25.122 ms | 26.400 ms | 720/720 samples over 16.7 ms |
| Numeric churn, digit metrics + slot patch | 4.633 ms | 4.967 ms | 0/720 samples over 16.7 ms |
| Mixed-z movement before per-bucket translation | 1.409 ms | 1.533 ms | 720 translation fallbacks |
| Mixed-z movement after per-bucket translation | 0.617 ms | 0.767 ms | 358,155 translated runs; no fallbacks |

The final numeric run was about 90% faster than the original. It recorded
358,832 compatible run patches and 4,557,707 in-place glyph-slot writes.
Shape-cache misses fell from 359,744 to 197, with 1,168 safe run-patch
fallbacks. All 32 sampled labels remained rendered.

## GPU marker suite

The marker suite offers a quick one-round check and a thorough three-round run
through 10,000 markers. It covers one/four z buckets, deliberately CPU-driven
pulse updates, default GPU Sprite FX pulse, visibility churn, forced camera
movement, and stable-live-count appearance churn. Static and GPU-pulse cases
exercise cached projection; orbit measures full reprojection plus the
TextRenderer position batch.

Workload version 4 adds marker appearance churn and cache/atlas statistics. It
rotates marker colors and borders across a fixed 10,000-marker population.

The JSON report separates application mutation from
`updateAnnotationLayer()`, retains combined CPU cost, and includes preparation
and first-frame costs, frame cadence, dropped frames, optional asynchronous
whole-frame Lite GPU timestamps, fast-path/cache deltas, draw calls,
environment information, and sampled correctness. Thorough mode uses 15
settling frames, 30 excluded warm-up frames, and three 180-frame measured
rounds, reporting the median round summary.

A Chrome 150/Windows/DPR 1 version 2 run on a 1669 x 953 canvas measured 10,000
camera-orbit markers at 2.72 ms mean / 3.0 ms p95, down from 7.85 / 8.6 ms
before position batching. Static and GPU-pulse cases were about 0.40 ms.

A newer version 3 run at 1920 x 953 produced these 10,000-marker medians:

| Workload | CPU mean / p95 | GPU mean / p95 | Result |
| --- | ---: | ---: | --- |
| Static, one bucket | 0.39 / 0.50 ms | 0.33 / 0.87 ms | No backend writes |
| GPU pulse | 0.37 / 0.60 ms | 0.34 / 0.90 ms | No per-frame marker writes |
| Visibility churn | 2.03 / 2.30 ms | 0.76 / 0.90 ms | 1,250 hide + 1,250 show writes/frame |
| Camera orbit | 2.94 / 3.60 ms | 0.28 / 0.87 ms | About 10,000 batched positions/frame |
| CPU-driven pulse comparison | 18.01 / 21.00 ms | 1.86 / 3.35 ms | Anti-pattern; use GPU pulse |

Stable checksums matched across rounds. First-frame configuration costs ranged
from 14.7 to 41.9 ms when thousands of definitions, z buckets, or animation
layers changed together. Prepare large sets before showing them or spread
application updates across frames. Version 2 and 3 CPU results are not directly
interchangeable because version 3 uses longer rounds and separated timers.

## Collision stress

The collision stress scene has selectable 100, 250, and 500-label loads with
moving anchors, changing text widths, and clamped edge labels. Its panel shows
the latest update, arithmetic mean, and p95. A 7.6 ms p95 means 95% of sampled
annotation updates completed in 7.6 ms or less.

## Interaction benchmark

The GPU interaction demo benchmarks 100/1,000/10,000 targets after an excluded
warm-up. It measures viewport-wide and center-dense query throughput,
camera-wide and one-percent partial index movement, and a 32/64/128 CSS-pixel
cell-size sweep.

One Chrome 150/Windows/DPR 1 run produced:

| Targets | Viewport queries/s | Center-dense queries/s | Full camera index | 1% incremental index |
| ---: | ---: | ---: | ---: | ---: |
| 100 | 3.03 million | 3.77 million | 0.20 ms | 0.20 ms / 1 target |
| 1,000 | 3.08 million | 1.67 million | 0.60 ms | 0.10 ms / 10 targets |
| 10,000 | 568,000 | 168,000 | 6.00 ms | 0.20 ms / 100 targets |

At 10,000 markers, 32 px cells reached about 338,000 center-dense queries/s
with 49 average candidates, versus 179,000 and 136 candidates at 64 px, or
84,000 and 419 candidates at 128 px. The 32 px index used 426 cells and took
6.1 ms to build; 64 px used 119 cells and took 5.0 ms. Keep the balanced 64 px
default for moving scenes; prefer 32 px for mostly static, dense,
query-intensive views.
