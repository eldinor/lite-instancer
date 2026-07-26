# Instancer–Interacter Adapter Decision

Status: implemented prototype  
Updated: 2026-07-26

## Decision

Ship the integration as the optional `@litools/instancer/interacter` subpath, not inside `@litools/interacter` and not as a separate package yet.

This ownership direction is intentional: Instancer knows stable IDs and slot compaction, while Interacter knows interaction scheduling and event delivery. Interacter core remains unaware of Instancer. The adapter subpath follows the repository's existing integration-entry pattern, adds no code to Instancer's main entry, and avoids another package lifecycle for less than one kilobyte of runtime code.

## Contract

The adapter depends on only three public capabilities:

- a Babylon Lite mesh or explicit mesh collection;
- `getIdForSlot(slot)` on the instance source;
- Interacter's public `registerMesh()` and target disposal functions.

The slot resolver runs when Interacter creates an event. It never caches renderer slots. A removal or visibility operation may move an ID to another slot, but the next event resolves the new occupant from the source's current mapping.

Single-mesh `InstanceSet` and `VatInstanceSet` objects satisfy the adapter structurally. Hierarchy sources use explicit meshes and one shared resolver. Multi-mesh registration is atomic and rolls back targets created by the failed call. Its binding owns only Interacter registrations; it never owns meshes or the instance source.

## Identity model

One Interacter target represents each backing mesh, not each logical instance. `event.target` retains normal Interacter registration identity, `event.thinInstanceIndex` remains the renderer slot for diagnostics, and `event.instanceId` is the stable application identity.

Creating one target per stable ID would duplicate registrations, become expensive for large populations, and require target churn after create/remove operations. Event-time stable-ID resolution is both smaller and consistent with Instancer's slot lifecycle.

## Lifecycle

Applications must dispose the Interacter target or multi-mesh binding before disposing the source instance set. The common Instancer contract has no disposal notification, so automatic cross-package ownership would require a new lifecycle capability and would make teardown direction ambiguous.

## Unsupported case

`VatCharacterSet` secondary parts use separate internal instance sets and private primary/secondary ID maps. The current public API exposes secondary meshes but not `secondary slot -> primary stable ID`. Only the primary VAT set can be registered safely today.

The adapter must not inspect private fields or assume matching slots. Supporting every character part requires an Instancer API such as `getPrimaryIdForPartSlot(mesh, slot)` or public pick-source descriptors. That capability should be added only when a real multi-part interaction use case requires it.

## Example

The Interacter examples site includes `/instancer-adapter/`. It renders one colored `InstanceSet`, registers it through the public adapter subpath, and displays `event.instanceId` beside the transient renderer slot. Removing a selected non-final instance logs the swap-compaction move and updates the live slot map, making the identity guarantee directly observable without browser automation.

## Package decision

A separate `@litools/interacter-instancer` package is not justified yet. Reconsider it only if the integration grows independent release needs, adapters for multiple Instancer implementations, or substantial runtime policy. Until then, an Instancer-owned optional subpath expresses dependency direction more clearly and has less maintenance overhead.
