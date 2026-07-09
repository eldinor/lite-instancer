# Shark School Shared Animation

Uses:

```txt
https://assets.babylonjs.com/meshes/shark.glb
```

Demonstrates animated GLB-style behavior with VAT-backed instances by default.

The example bakes the shark's skinned animation into a VAT mesh when available, then gives each instance its own animation phase. Use `?vat=0` to fall back to hierarchy instances that animate each shark's transform independently.

Run from the root examples index with:

```sh
npm run dev
```

Open `/examples/shark-school-shared-animation/`.
