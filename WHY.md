# Why This Package Exists

Babylon Lite gives applications fast instancing primitives, but real apps usually need more than fast draw calls. They need objects that can be selected, hidden, updated, removed, labeled, and connected to application state without leaking low-level render slots into the rest of the codebase.

`@litools/instancer` exists to bridge that gap.

Thin instances and hierarchy instance pools are efficient because they work with compact internal slots. Those slots are allowed to move, especially when instances are removed or visibility is reorganized. That is good for rendering performance, but awkward for application logic. A selected tree, box, boombox, or shark should remain the same logical object even if its GPU slot changes.

This package wraps Babylon Lite instances with stable application-level IDs. The renderer can keep using fast slot-based storage, while the app gets durable handles for gameplay, editor tools, picking, metadata, visibility, and batch updates.

The package is needed because common interactive 3D workflows all depend on stable identity:

- selecting an instance and keeping it selected after other instances are removed
- mapping a pick result back to the logical app object
- hiding and showing groups without losing metadata
- streaming many transform updates without breaking invariants
- managing loaded GLB hierarchies as one logical instance
- growing or rebuilding pools while preserving app state
- handling animated or VAT-backed examples where visual identity and raw mesh slots are not the same thing

Without this layer, every app has to rebuild the same fragile bookkeeping around `thinInstanceIndex`, swap-remove behavior, metadata maps, and visibility state. `@litools/instancer` makes that bookkeeping explicit, tested, and reusable.

The package does not try to replace Babylon Lite. Its purpose is smaller and more practical: keep Babylon Lite's rendering model intact, then add the application-facing lifecycle that developers expect when building tools, editors, simulations, games, and dense interactive scenes.

In short, this package exists so instance-heavy Babylon Lite apps can treat repeated meshes like real objects instead of temporary render slots.
