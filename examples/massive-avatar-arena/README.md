# Massive Avatar Arena

Open `/examples/massive-avatar-arena/` through `npm run dev`.

This scene combines four animated GLBs from `eldinor/ForBJS`:

- `avatar_3.glb` supplies the 2,000-capacity lightweight citizen crowd.
- `avatar_2.glb` supplies 360 multi-part alien VAT characters.
- `avatar_4.glb` supplies 140 detailed robot VAT characters.
- `avatar_5.glb` remains a full-quality live-skeleton hero with a pulsing outline.

The three crowd skeletons are baked independently, while a semantic clip map normalizes their differently named idle, walk, run, jump, kick, fall, and landing animations. The reaction control sends those actions outward as a radial wave. Population presets start at 100, then cycle through 500 and 2,500 without rebuilding the pools. Packed `active-count` visibility keeps hidden capacity out of the vertex workload.

Click a crowd character to select it through logical screen-space picking. Use the camera control to alternate between the complete arena and the outlined hero.
