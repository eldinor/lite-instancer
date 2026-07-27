import type { Font, PlacedGlyph, TextLayoutOptions } from "@babylonjs/lite";

// This module is intentionally bundled only into the optional textrender entry.
// @ts-expect-error Babylon Lite intentionally does not publish declarations for this private module.
import { layoutText as litePrivateLayoutText } from "../../../node_modules/@babylonjs/lite/lib/text/layout.js";

export interface PrivateTextLayoutResult {
  readonly glyphs: readonly PlacedGlyph[];
  readonly pixelsPerFontUnit: number;
  readonly width: number;
  readonly height: number;
}

export function guardedPrivateLayoutText(
  font: Font,
  text: string,
  fontSizePx: number,
  options?: TextLayoutOptions
): PrivateTextLayoutResult {
  const rawFont = (font as unknown as { _font?: unknown })._font;
  if (!isRecord(rawFont) || typeof rawFont.scaleForSize !== "function" || typeof rawFont.glyphId !== "function") {
    throw new Error("Babylon Lite private Font structure is incompatible");
  }
  const result: unknown = litePrivateLayoutText(font, text, fontSizePx, options);
  if (!isPrivateLayoutResult(result)) {
    throw new Error("Babylon Lite private text layout result is incompatible");
  }
  return result;
}

function isPrivateLayoutResult(value: unknown): value is PrivateTextLayoutResult {
  if (!isRecord(value) || !Array.isArray(value.glyphs)) return false;
  if (!isFiniteNonNegative(value.width) || !isFiniteNonNegative(value.height)) return false;
  if (typeof value.pixelsPerFontUnit !== "number" || !Number.isFinite(value.pixelsPerFontUnit)) return false;
  return value.glyphs.every((glyph) =>
    isRecord(glyph) &&
    typeof glyph.glyphId === "number" && Number.isFinite(glyph.glyphId) &&
    typeof glyph.x === "number" && Number.isFinite(glyph.x) &&
    typeof glyph.y === "number" && Number.isFinite(glyph.y)
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isFiniteNonNegative(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}
