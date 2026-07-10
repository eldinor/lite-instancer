# BoomBox Picker

Uses:

```txt
https://playground.babylonjs.com/scenes/BoomBox.glb
```

Demonstrates resolving a clicked child mesh and `thinInstanceIndex` back to a stable logical BoomBox ID.

The example uses `PickingRegistry` with a hierarchy instance pool. Click a BoomBox to select its stable ID, then remove it. The pool uses `"active-count"` visibility/removal, so slots move, but the selected ID and metadata still identify the correct BoomBox.

Run from the root examples index with:

```sh
npm run dev
```

Open `/examples/boombox-picker/`.
