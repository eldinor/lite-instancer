# Why This App Exists

Animated crowds are a common pressure point for realtime 3D apps. A single animated character is straightforward, but dozens of skinned characters can quickly become expensive to update, draw, pick, and manage.

This example exists to show how a school of animated sharks can stay practical while still behaving like normal app objects. Each shark has a stable ID, metadata, visibility control, selection, picking, and batched transform updates. That makes the example useful for testing real application workflows, not just rendering a pretty scene.

The app is also a proving ground for VAT mode. Vertex animation textures let the shark animation be baked once and replayed efficiently across many instances. With VAT enabled by default, the example demonstrates the target path for shared animation: many animated instances, varied phases, and lower per-instance animation cost.

The fallback hierarchy mode still matters. It keeps the example useful when VAT is unavailable and gives a direct comparison against a more conservative GLB hierarchy approach.

In short, this app is needed because it exercises the hard parts of an instancing library in one compact scenario:

- animated GLB content
- many repeated instances
- stable instance IDs
- metadata-driven behavior
- picking and selection
- visibility toggles
- batch updates
- VAT-backed shared animation

That combination helps validate that the library can support real interactive scenes, not only static mesh duplication.
