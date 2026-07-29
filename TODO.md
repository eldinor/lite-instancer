# TODO

## Annotator TextRenderer

### Bound appearance and atlas caches

The TextRenderer backend caches parsed colors and generated GPU sprite frames
so annotations that share styles remain inexpensive. The following caches can
currently grow for the backend's lifetime:

- CSS color strings mapped to parsed linear RGBA values.
- Marker appearances mapped to Sprite2D atlas frames.
- Label-background appearances mapped to reusable nine-slice frames.
- The sprite atlas containing the corresponding marker and background pixels.

This is efficient for applications with a small, reused design system, but
continuously generated colors, border widths, radii, sizes, or custom marker
styles can produce unbounded cache and atlas growth even when the number of
live annotations remains stable.

Proposed design:

- Add configurable limits for the color, marker-frame, and background-frame
  caches.
- Use a simple least-recently-used policy for parsed colors.
- Store marker and background frames as reference-counted records.
- Increment references when annotations adopt a frame and decrement them when
  annotations change style or are disposed.
- Evict only frame records with no live references.
- Reuse freed atlas slots if Babylon Lite supports replacing frame pixels.
- If atlas slots cannot be reused, define separate soft cache and hard atlas
  limits. Avoid pretending that deleting a map entry releases GPU memory.
- At the hard limit, use an explicitly documented policy such as declining to
  cache one-off appearances or throwing a clear capacity error. Do not silently
  reuse an incorrect visual style.
- Expose `colorCacheEntries`, `markerFrameCacheEntries`,
  `backgroundFrameCacheEntries`, `atlasFrames`, estimated `atlasBytes`,
  `evictions`, and `capacityMisses` through `getStats()`.

Illustrative configuration:

```ts
createTextRendererAnnotationBackend({
  shapeCacheSize: 512,
  colorCacheSize: 256,
  markerFrameCacheSize: 256,
  backgroundFrameCacheSize: 128
});
```

This is primarily memory-safety work for long-running editors, dashboards, and
telemetry applications with highly dynamic styling. It is less urgent for
fixed-theme applications that reuse a small set of appearances.

