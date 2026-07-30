# Feature request: expose the Babylon Lite text-layout API

## Summary

Please expose Babylon Lite's text-layout function through a supported public
module and package export.

`@litools/annotator` uses Babylon Lite's TextRenderer for batched GPU labels.
It needs the same glyph placement and metrics that Babylon Lite uses internally
so it can update compatible text runs efficiently.

## Current workaround

Annotator currently imports the private layout module directly:

```ts
import { layoutText } from
  "../../../node_modules/@babylonjs/lite/lib/text/layout.js";
```

This adapter is guarded and permanently falls back to the public shaping path
if the private API has an unexpected structure or throws. Nevertheless, the
deep import is inherently version-sensitive and package-manager-dependent.

It also bypasses the normal `@babylonjs/lite` external-package boundary during
the Annotator build. Vite consequently bundles Babylon Lite's text shaper into
`textrender.js`.

For the current build:

- `textrender.js`: approximately 172 KB raw and 46 KB gzip.
- `textrender.js.map`: approximately 957 KB raw and 200 KB gzip.
- About 705 KB of the uncompressed source map is embedded Babylon Lite
  `text-shaper` source.

The source map is not a runtime JavaScript cost, but it significantly increases
the published package and debugging artifact size.

## Requested API

A minimal public export would be sufficient:

```ts
import {
  layoutText,
  type TextLayoutResult
} from "@babylonjs/lite/text";

const result = layoutText(font, text, options);
```

The result should expose the information already produced by the internal
layout operation:

```ts
interface TextLayoutResult {
  readonly glyphs: readonly PlacedGlyph[];
  readonly pixelsPerFontUnit: number;
  readonly width: number;
  readonly height: number;
}
```

The exact module name and type shape can follow Babylon Lite's conventions.
The important requirements are:

1. The layout function is part of the documented public API.
2. It returns positioned glyphs and the scale used to interpret their metrics.
3. Its output is compatible with Babylon Lite's public TextRenderer types.
4. The module is declared in the package `exports` map and includes TypeScript
   declarations.

## Why shaping alone is insufficient

Annotator must measure labels and preserve Babylon Lite's exact glyph
placement. Public shaping data without the final layout positions requires
Annotator to duplicate Lite's layout rules. That risks differences in
advances, offsets, line dimensions, and future text behavior.

Using Lite's own layout result provides one source of truth for measurement and
rendering.

## Benefits

- Removes a fragile private deep import.
- Allows Babylon Lite to remain an external peer dependency.
- Avoids bundling a second copy of the text shaper.
- Reduces Annotator's JavaScript and source-map artifacts.
- Gives other libraries a supported way to measure and prepare GPU text.
- Keeps third-party label placement consistent with Babylon Lite rendering.

## Compatibility

This request does not require exposing TextRenderer internals or mutable glyph
storage. A stable, read-only layout result is enough.

Annotator can retain its current guarded fallback while adopting the public API,
so the change would not require an immediate breaking release on either side.
