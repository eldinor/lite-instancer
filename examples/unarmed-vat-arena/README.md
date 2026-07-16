# Unarmed VAT Arena Crowd

Open `/examples/unarmed-vat-arena/` through `npm run dev`.

The scene has three independently baked VAT groups with a capacity of 1,000 characters each:

- Vanguard: `UnarmedRunForward`.
- Melee field: `UnarmedAttackL1`, `UnarmedAttackR1`, `UnarmedBlock`, and `UnarmedGetHitF1`.
- Sentry ring: `UnarmedIdle`, `UnarmedIdleAlert1`, `UnarmedStrafeLeft`, and `UnarmedStrafeRight`.

Only those nine named clips are supplied to VAT baking; the remaining source clips are excluded. The density button cycles 300–3,000 visible characters. `scale-zero` visibility preserves slot alignment with VAT playback, and each group receives deterministic phase offsets plus small FPS variation.

The example does not switch clips during the frame loop. It batches per-group transforms and advances each group's VAT playback once per frame. Controls provide pause, phase reshuffle, group camera focus, and auto-orbit.
