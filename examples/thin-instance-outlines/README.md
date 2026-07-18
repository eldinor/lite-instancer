# Thin Instance Outline Gallery

One page with nine directly addressable Babylon Lite outline demonstrations:

- `?demo=selection` — stable-ID selection while instances are added, removed, hidden, and moved between slots.
- `?demo=shapes` — outlined box, sphere, cylinder, capsule, torus, and torus knot geometry.
- `?demo=shaderball` — the native Lite-loaded Babylon Shader Ball hierarchy and PBR material with outline winding compensated for the mirrored glTF root.
- `?demo=marble` — all eight native Lite-loaded Marble Tower parts and materials with per-part outlines compensated for the mirrored glTF root.
- `?demo=colors` — simultaneous per-instance colors and animation phases.
- `?demo=normals` — paired smoothed and authored-normal comparisons for a box, hexagonal prism, square pyramid, and triangular prism.
- `?demo=single` — ordinary meshes, non-uniform scaling, and mirrored scaling.
- `?demo=effects` — pulse on a sphere, hue cycle on a torus, edge flow on a capsule, rim flow on a torus knot, and sizzle on a box.
- `?demo=standalone` — raw Babylon Lite thin-instance indices without `InstanceSet`.

Run `npm run dev`, open `/examples/thin-instance-outlines/`, and use the scenario links in the top menu. The left panel is reserved for the active demo's controls and status. Switching scenarios reloads the page so the previous scene and outline resources are fully released.

The inverted-hull renderer formally supports opaque hosts. Thickness is displaced in object space, so non-uniform scaling changes its apparent world-space width. Mirrored transforms can change winding parity and are displayed as a documented limitation rather than hidden.
