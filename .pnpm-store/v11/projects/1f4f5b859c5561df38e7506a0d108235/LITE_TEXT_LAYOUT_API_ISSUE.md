# Feature request: expose text layout as a public API for shared `GlyphStorage` batching

## Summary

Babylon Lite's public text APIs currently make the convenient path
(`createDefaultTextData`) allocate and own a separate `GlyphStorage` for every
text block. The lower-level APIs support shared glyph storage and multiple
`GlyphRun`s in one `TextData`, but there is no public function that shapes and
lays out a string into `PlacedGlyph`s.

Could Lite expose its existing text layout operation, or an equivalent public
run-building helper, so applications can batch many independently positioned
text blocks into one `TextData` backed by shared `GlyphStorage`?

## Motivation

We are building a GPU backend for `@litools/annotator`, a screen-space spatial
annotation library for Babylon Lite. A typical layer contains 100-500 labels.
Their projected positions can change every frame, while their text changes less
frequently.

The scalable TextRenderer representation is:

```text
one shared GlyphStorage per font/face
             |
one GlyphRun per annotation
             |
one shared TextData
             |
one TextLayer / TextRenderer draw group
```

This allows labels to share glyph curves and lets `updateTextData` reuse dirty
instance ranges and cached render bundles. The alternative of one
`DefaultTextData` and one `TextLayer` per label creates hundreds of storages,
GPU buffers, render bundles, and draw calls.

## Current public workaround

The only public way to obtain Lite-shaped `PlacedGlyph`s and layout dimensions
for an arbitrary string is to create a temporary `DefaultTextData`:

```ts
const temporary = createDefaultTextData(
  font,
  fontSizePx,
  text,
  color,
  layoutOptions
);

const sourceRun = temporary.runs[0];
const glyphIds = new Set(sourceRun.glyphs.map((glyph) => glyph.glyphId));
const curves = new Map<number, GlyphCurves>();

// createDefaultTextData already extracted these curves into its private,
// individually-owned storage. Extract them again for the shared storage.
extractGlyphCurves(font, glyphIds, curves);
updateGlyphStorage(sharedStorage, applicationCurveSetId, curves);

const sharedRun: GlyphRun = {
  curveSet: applicationCurveSetId,
  glyphs: sourceRun.glyphs,
  pixelsPerFontUnit: sourceRun.pixelsPerFontUnit,
  defaultColor: sourceRun.defaultColor
};

const metrics = { width: temporary.width, height: temporary.height };
disposeDefaultTextData(temporary);
```

This produces the correct result using public APIs, but every cache miss:

1. creates a temporary `GlyphStorage`;
2. extracts and packs glyph curves into that temporary storage;
3. extracts the same curves again for the shared storage; and
4. immediately disposes the temporary text data and storage.

The internal `layoutText` operation already produces the data needed before
storage creation, but it is not exported by `@babylonjs/lite` and package export
maps correctly prevent importing `@babylonjs/lite/lib/text/layout.js`.

## Proposed minimal API

Export the existing layout operation and its result type from the package root:

```ts
export interface TextLayoutResult {
  readonly glyphs: readonly PlacedGlyph[];
  readonly pixelsPerFontUnit: number;
  readonly width: number;
  readonly height: number;
}

export function layoutText(
  font: Font,
  text: string,
  fontSizePx: number,
  options?: TextLayoutOptions
): TextLayoutResult;
```

This should be a CPU-only operation. It should not create `GlyphStorage`,
`TextData`, textures, or GPU resources.

Applications can then use the already-public `extractGlyphCurves`,
`updateGlyphStorage`, `createTextData`, and `updateTextData` APIs to choose their
own storage and batching strategy:

```ts
const layout = layoutText(font, text, fontSizePx, layoutOptions);
const glyphIds = new Set(layout.glyphs.map((glyph) => glyph.glyphId));
const curves = new Map<number, GlyphCurves>();

extractGlyphCurves(font, glyphIds, curves);
updateGlyphStorage(sharedStorage, curveSetId, curves);

const run: GlyphRun = {
  curveSet: curveSetId,
  glyphs: layout.glyphs,
  pixelsPerFontUnit: layout.pixelsPerFontUnit,
  defaultColor: color
};
```

An alternative higher-level API that accepts caller-owned storage would also
solve the use case:

```ts
export function createGlyphRun(
  font: Font,
  storage: GlyphStorage,
  curveSetId: CurveSetId,
  fontSizePx: number,
  text: string,
  color?: readonly [number, number, number, number],
  options?: TextLayoutOptions
): {
  readonly run: GlyphRun;
  readonly width: number;
  readonly height: number;
};
```

The lower-level `layoutText` export is preferable because it composes with the
existing public storage APIs and does not impose storage ownership policy.

## Suggested contract details

- Document whether `width` is advance width or ink width.
- Document that `height` is derived from line count and configured line height.
- Document the `PlacedGlyph.y` origin and baseline convention.
- Preserve the current `TextLayoutOptions` behavior for wrapping, alignment,
  line height, letter spacing, and tabs.
- Returning immutable data would make shaped-run caching safe for callers.
- If practical, exposing baseline/ascent/descent or ink bounds would help UI
  alignment, but those metrics are not required for the minimal batching use
  case.

## Acceptance criteria

- A supported root export can shape/layout text without allocating glyph
  storage or GPU resources.
- Its result can be used directly to construct a public `GlyphRun`.
- Width and height match `createDefaultTextData` for the same inputs.
- Existing `createDefaultTextData` behavior remains unchanged.
- A test or example demonstrates two or more independently positioned runs
  sharing one `GlyphStorage` and one `TextData`.

## Environment

- `@babylonjs/lite`: `1.14.0`
- Renderer: WebGPU `TextRenderer`
- Consumer: a tree-shakable optional GPU-text backend for
  `@litools/annotator`

