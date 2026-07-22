# Babylon Lite Instancer: Non-VAT Improvement Findings

Review date: 2026-07-22

Implementation status: priorities 1-3, deterministic performance boundaries, allocation reduction, lifecycle hardening, screen-space picking, outline hot-path work, and single-mesh dynamic draw counts are complete. Count-only changes now avoid full-prefix matrix dirtiness after GPU warm-up, with exact newly exposed ranges and a safe legacy fallback. Hierarchy draw counts remain on the existing API until Babylon Lite exposes an equivalent public boundary.

## Scope

This review covers ordinary mesh instances, hierarchy instances, visibility, picking, outlines, diagnostics, and lifecycle safety. VAT playback, VAT assets, and LOD/culling policy are intentionally excluded.

## Highest-priority findings

### 1. Preserve partial matrix dirtiness through batches

`InstanceSet.batch()` currently calls Babylon Lite's `flushThinInstances()` after per-slot matrix setters. That final call marks the full active matrix prefix dirty, replacing the narrower dirty interval already collected by `setThinInstanceMatrix()`.

Recommended change:

- Keep per-slot setters as the normal matrix update path.
- Do not call the full flush at the end of a normal batch.
- Retain the full flush for `editRaw()`, because direct writes to the exposed array cannot otherwise be observed.
- Measure CPU dirty bytes separately from bytes ultimately uploaded by the renderer.

Expected effect: sparse and adjacent matrix edits retain their bounded dirty interval instead of becoming a full active-prefix upload.

### 2. Coalesce bulk lifecycle and count operations

`createMany()` and `removeMany()` currently execute each item as an independent operation. In ordinary `InstanceSet`, draw-count updates also bypass the batch boundary. Hierarchy instances already have deferred dirty-slot state, but their bulk helpers do not use it.

Recommended change:

- Run `createMany()` and `removeMany()` inside one batch for both instance-set implementations.
- Defer and deduplicate thin-instance draw-count synchronization until the outer batch exits.
- Keep nested batches correct and issue no count call if the final count equals the last synchronized count.

Expected effect: one count synchronization per bulk operation rather than one per item, with fewer JS-to-renderer calls.

### 3. Restrict render-bundle invalidation to structural changes

Matrix, color, and instance-count setters update existing buffers and should not invalidate cached render bundles. Capacity growth, hierarchy-pool rebuilding, and first-time/replacement color-buffer binding are structural and still require invalidation when an engine context is supplied.

Recommended policy:

| Operation | Invalidate bundles |
| --- | --- |
| Matrix value edit | No |
| Existing color value edit | No |
| Draw-count edit | No |
| Capacity resize / buffer replacement | Yes |
| Hierarchy pool rebuild | Yes |
| Color buffer bind or replacement | Yes |

Expected effect: stable render bundles survive routine animation, movement, tint, visibility, creation, and removal updates.

### 4. Add deterministic non-VAT performance boundaries

Wall-clock microbenchmarks are noisy and can overheat development machines. The first performance suite should instead assert renderer-facing work:

- thin-instance matrix setter calls;
- hierarchy matrix setter calls;
- count setter calls;
- full-flush calls;
- bundle invalidations;
- matrix dirty-span bytes.

These tests should cover bulk create, bulk remove, sparse/adjacent matrix edits, visibility packing, and structural growth. They are regression boundaries, not browser FPS claims.

## Next improvements after items 1-2

### Allocation reduction

- Replace `Float32Array.slice()` swap temporaries with reusable 16-float scratch storage.
- Add in-place transform helpers so `setPosition()`, `translate()`, and `setScale()` do not create intermediate matrices.
- Reuse screen-space projection scratch values during picking.

### Lifecycle and API safety

- Add consistent disposed-state guards and idempotent disposal.
- Define and document mesh/root ownership rules.
- Validate an instance ID in `getColor()` even when the color stream has not yet been created.
- Add development diagnostics for count, capacity, visible count, pending dirty work, and structural rebuilds.

### Picking

- Reject points behind the camera before screen-space distance testing.
- Add broad-phase candidate filtering for large populations.
- Offer caller-owned output/scratch objects on allocation-sensitive query paths.

### Outlines

- Avoid per-frame `Object.values()` allocation when checking active outline layers.
- Skip bone uploads when no outlined instances are active.
- Consider automatic dirty tracking while retaining explicit refresh for advanced integrations.

## Lite-first, Babylon.js-ready rules

- Preserve stable `InstanceId`, slot swaps, visibility packing, and lifecycle semantics across engines.
- Treat dirty slots/ranges and renderer calls as separate concerns.
- Keep renderer objects out of portable contract fixtures.
- Run the same lifecycle and work-count scenarios against Babylon.js later, while its adapter maps ranges to `thinInstancePartialBufferUpdate()`.
- Do not add a shared runtime dependency until both implementations demonstrate a genuinely reusable surface.

## Recommended implementation order

1. Fix ordinary and hierarchy bulk batching, full dirty flushes, and structural invalidation boundaries.
2. Add non-VAT call-count and dirty-byte regression tests.
3. Reduce swap and transform allocations. **Complete.**
4. Harden lifecycle ownership and disposed-state behavior. **Complete.**
5. Optimize picking and outline hot paths with focused work-boundary tests. **Complete.**
