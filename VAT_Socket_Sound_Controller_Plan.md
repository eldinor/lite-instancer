# VAT Socket Sound Controller

## Summary

Add a reusable, asynchronous VAT socket audio controller that positions Babylon Lite spatial sounds at sampled VAT sockets. It supports both looped, controller-managed sounds and explicit one-shot playback per character binding.

## Key changes

- Add `createVatSocketSoundControllerAsync()` and export it from the root and VAT entry points.
  - Accept an `AudioEngine`, source sound URL/buffer, `VatPlaybackSource`, socket asset/key, spatial options, optional listener target, and an `autoUpdateSpatialAudio` flag defaulting to `true`.
  - Decode the supplied source once into a shared `SoundBuffer`; create one `StaticSound` per character binding so simultaneous characters retain independent spatial positions.
  - Maintain a lightweight internal `SpatialTarget` per binding and write its matrix from the same sampled socket-world transform used by rigid VAT attachments.
  - `bind()` asynchronously creates the per-character sound. Bind options support loop/autoplay defaults.
  - `play()` and `stop()` provide explicit one-shot/event control. Looping bindings stop while their character is hidden and resume when visible.
  - `update()` refreshes bound socket matrices and, by default, calls Lite’s `updateSpatialAudio()`. An opt-out supports apps with a centralized audio update.
  - `unbind()` and `dispose()` stop, detach, and dispose binding sounds safely.

- Extract the shared VAT-playback-sample-to-socket-world-matrix calculation so rigid attachments and sounds cannot drift in transform behavior.

- Add a Ready Player/Samba socket-audio demonstration.
  - Use `https://playground.babylonjs.com/sounds/violons11.wav`.
  - Attach the listener to the active camera.
  - Provide a user-initiated play/stop control to respect browser audio-gesture requirements; do not autoplay on page load.

## Test plan

- Mock Lite audio functions and verify one sound buffer decode with one independent spatial sound per binding.
- Verify socket matrix updates reach each spatial target and remain correct after stable-ID slot changes.
- Verify looped sound hide/resume behavior, explicit one-shot playback, unbind, and disposal.
- Verify `autoUpdateSpatialAudio` defaults on and can be disabled.
- Keep existing VAT attachment tests passing; run typecheck and the full test suite without a build.

## Assumptions

- The controller owns sounds it creates; callers supply the audio engine and source but do not dispose binding sounds directly.
- Spatial updates are self-contained by default, with an opt-out for centralized audio systems.
- The example uses a remote audio asset to avoid adding a tracked binary asset.
