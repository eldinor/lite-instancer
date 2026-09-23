import type { Font, GlyphRun, PlacedGlyph, TextData, TextLayoutOptions } from "@babylonjs/lite";

// This module is intentionally bundled only into the optional textrender entry.
// @ts-expect-error Babylon Lite intentionally does not publish declarations for this private module.
import { layoutText as litePrivateLayoutText } from "../../../node_modules/@babylonjs/lite/lib/text/layout.js";

export interface PrivateTextLayoutResult {
  readonly glyphs: readonly PlacedGlyph[];
  readonly pixelsPerFontUnit: number;
  readonly width: number;
  readonly height: number;
}

export interface PrivateRunTranslation {
  readonly run: GlyphRun;
  readonly dx: number;
  readonly dy: number;
}

export interface PrivateRunPatch {
  readonly run: GlyphRun;
  readonly glyphs: readonly PlacedGlyph[];
  readonly pixelsPerFontUnit: number;
  readonly offsetX: number;
  readonly offsetY: number;
  readonly color: readonly [number, number, number, number];
}

/**
 * Rewrites a compatible run's existing instance slots without replacing the
 * public GlyphRun object or allocating a positioned glyph array.
 */
export function guardedPrivatePatchRun(data: TextData, patch: PrivateRunPatch): number | false {
  const candidate = data as unknown as {
    _instances?: unknown;
    _instancesU32?: unknown;
    _styles?: unknown;
    _runRecords?: unknown;
    _groups?: unknown;
    _instanceCount?: unknown;
    _dirtyStart?: unknown;
    _dirtyEnd?: unknown;
    _version?: unknown;
    _styleVersion?: unknown;
  };
  if (
    !(candidate._instances instanceof Float32Array) ||
    !(candidate._instancesU32 instanceof Uint32Array) ||
    candidate._instancesU32.buffer !== candidate._instances.buffer ||
    !(candidate._styles instanceof Float32Array) ||
    !(candidate._runRecords instanceof Map) ||
    !Array.isArray(candidate._groups) ||
    typeof candidate._instanceCount !== "number" ||
    typeof candidate._dirtyStart !== "number" ||
    typeof candidate._dirtyEnd !== "number" ||
    typeof candidate._version !== "number" ||
    typeof candidate._styleVersion !== "number"
  ) return false;

  const record = candidate._runRecords.get(patch.run);
  if (!isRecord(record) || !Array.isArray(record._slots) ||
      !Array.isArray(record._styleSlots) || record._styleSlots.length !== 1 ||
      typeof record._groupIdx !== "number") {
    return false;
  }
  const group = candidate._groups[record._groupIdx];
  if (!isRecord(group) || !isRecord(group._curveSet) ||
      !isRecord(group._curveSet._atlas) ||
      !(group._curveSet._atlas._glyphSlots instanceof Map)) {
    return false;
  }
  const slots = record._slots as unknown[];
  const defaultStyle = record._styleSlots[0];
  if (!Number.isInteger(defaultStyle) || (defaultStyle as number) < 0 ||
      (defaultStyle as number) > 0xffff) return false;
  const styleBase = (defaultStyle as number) * 8;
  if (styleBase + 5 >= candidate._styles.length) return false;
  const resolved: Array<{ slot: number; glyph: PlacedGlyph; glyphIndex: number }> = [];
  let liveIndex = 0;
  for (const glyph of patch.glyphs) {
    const atlas = group._curveSet._atlas._glyphSlots.get(glyph.glyphId);
    // Lite omits non-drawing glyphs such as spaces from a run's live slots.
    if (atlas === undefined) continue;
    const slot = slots[liveIndex++];
    if (!Number.isInteger(slot) || (slot as number) < 0 ||
        (slot as number) >= candidate._instanceCount ||
        !isRecord(atlas) || !Number.isInteger(atlas._index) ||
        (atlas._index as number) < 0 || (atlas._index as number) > 0xffff ||
        ((candidate._instancesU32[(slot as number) * 3 + 2] ?? 0) >>> 16) !== defaultStyle) {
      return false;
    }
    resolved.push({ slot: slot as number, glyph, glyphIndex: atlas._index as number });
  }
  if (liveIndex !== slots.length) return false;

  const instances = candidate._instances;
  const instancesU32 = candidate._instancesU32;
  const invScale = patch.pixelsPerFontUnit !== 0 ? 1 / patch.pixelsPerFontUnit : 0;
  let dirtyStart = Number.POSITIVE_INFINITY;
  let dirtyEnd = -1;
  for (const item of resolved) {
    const base = item.slot * 3;
    instances[base] = item.glyph.x + patch.offsetX;
    instances[base + 1] = item.glyph.y + patch.offsetY;
    instancesU32[base + 2] = item.glyphIndex | ((defaultStyle as number) << 16);
    dirtyStart = Math.min(dirtyStart, item.slot);
    dirtyEnd = Math.max(dirtyEnd, item.slot + 1);
  }
  const styleValues = [patch.color[0], patch.color[1], patch.color[2], patch.color[3], invScale] as const;
  let styleChanged = false;
  for (let index = 0; index < styleValues.length; index++) {
    const value = Math.fround(styleValues[index]!);
    if (candidate._styles[styleBase + index] !== value) {
      candidate._styles[styleBase + index] = value;
      styleChanged = true;
    }
  }
  if (styleChanged) candidate._styleVersion++;
  if (dirtyEnd >= 0) {
    if (candidate._dirtyStart === candidate._dirtyEnd) {
      candidate._dirtyStart = dirtyStart;
      candidate._dirtyEnd = dirtyEnd;
    } else {
      candidate._dirtyStart = Math.min(candidate._dirtyStart, dirtyStart);
      candidate._dirtyEnd = Math.max(candidate._dirtyEnd, dirtyEnd);
    }
    candidate._version++;
  }
  return resolved.length;
}

/**
 * Guarded Babylon Lite 1.31 bridge. Translates compact glyph slots in place
 * and publishes one combined dirty range without allocating replacement runs.
 */
export function guardedPrivateTranslateRuns(
  data: TextData,
  translations: readonly PrivateRunTranslation[]
): boolean {
  const candidate = data as unknown as {
    _instances?: unknown;
    _runRecords?: unknown;
    _instanceCount?: unknown;
    _dirtyStart?: unknown;
    _dirtyEnd?: unknown;
    _version?: unknown;
  };
  if (
    !(candidate._instances instanceof Float32Array) ||
    !(candidate._runRecords instanceof Map) ||
    typeof candidate._instanceCount !== "number" ||
    typeof candidate._dirtyStart !== "number" ||
    typeof candidate._dirtyEnd !== "number" ||
    typeof candidate._version !== "number"
  ) return false;

  const records = candidate._runRecords as Map<GlyphRun, unknown>;
  const resolved: Array<{ slots: readonly number[]; dx: number; dy: number }> = [];
  let dirtyStart = Number.POSITIVE_INFINITY;
  let dirtyEnd = -1;
  for (const translation of translations) {
    const record = records.get(translation.run);
    if (!isRecord(record) || !Array.isArray(record._slots)) return false;
    const slots = record._slots;
    if (!slots.every((slot) =>
      Number.isInteger(slot) && slot >= 0 && slot < (candidate._instanceCount as number)
    )) return false;
    resolved.push({ slots, dx: translation.dx, dy: translation.dy });
    for (const slot of slots) {
      dirtyStart = Math.min(dirtyStart, slot);
      dirtyEnd = Math.max(dirtyEnd, slot + 1);
    }
  }
  if (dirtyEnd < 0) return true;

  const instances = candidate._instances;
  for (const translation of resolved) {
    for (const slot of translation.slots) {
      const base = slot * 3;
      instances[base] = (instances[base] ?? 0) + translation.dx;
      instances[base + 1] = (instances[base + 1] ?? 0) + translation.dy;
    }
  }
  if (candidate._dirtyStart === candidate._dirtyEnd) {
    candidate._dirtyStart = dirtyStart;
    candidate._dirtyEnd = dirtyEnd;
  } else {
    candidate._dirtyStart = Math.min(candidate._dirtyStart, dirtyStart);
    candidate._dirtyEnd = Math.max(candidate._dirtyEnd, dirtyEnd);
  }
  candidate._version++;
  return true;
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
  if (isPrivateLayoutResult(result)) return result;
  if (isLite131PrivateLayoutResult(result)) {
    return {
      glyphs: result._glyphs,
      pixelsPerFontUnit: result._pixelsPerFontUnit,
      width: result._width,
      height: result._height
    };
  }
  throw new Error("Babylon Lite private text layout result is incompatible");
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

function isLite131PrivateLayoutResult(value: unknown): value is {
  readonly _glyphs: readonly PlacedGlyph[];
  readonly _pixelsPerFontUnit: number;
  readonly _width: number;
  readonly _height: number;
} {
  if (!isRecord(value) || !Array.isArray(value._glyphs)) return false;
  if (!isFiniteNonNegative(value._width) || !isFiniteNonNegative(value._height)) return false;
  if (typeof value._pixelsPerFontUnit !== "number" || !Number.isFinite(value._pixelsPerFontUnit)) return false;
  return value._glyphs.every((glyph) =>
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
