# Primitive Mixed Playground

Demonstrates multiple primitive `InstanceSet` managers in one scene.

Behavior:

- Boxes, spheres, and cylinders each have their own `InstanceSet`.
- One `PickingRegistry` resolves picks across all managers.
- Spawn, delete, recolor, and visibility controls work per primitive type.
- The strategy switch reloads between `active-count` and `scale-zero` visibility.
- Independent capacities and removals keep stable IDs per set.

Run from the root examples index with:

```sh
npm run dev
```

Open `/examples/primitive-mixed-playground/`.
