# BoomBox Rebuild Growth

Uses:

```txt
https://playground.babylonjs.com/scenes/BoomBox.glb
```

Demonstrates `grow: "rebuild"` for hierarchy pools, preserving IDs, transforms, metadata, visibility, and selection.

The example starts with capacity `4`. Use `add 1` or `add 8` to exceed capacity. The hierarchy pool is rebuilt at a larger capacity, while the selected stable ID and metadata remain usable.

Run from the root examples index with:

```sh
npm run dev
```

Open `/examples/boombox-rebuild-growth/`.
