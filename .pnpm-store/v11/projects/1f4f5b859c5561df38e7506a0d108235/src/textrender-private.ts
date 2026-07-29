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
    _runRecords?: unknown;
    _groups?: unknown;
    _instanceCount?: unknown;
    _dirtyStart?: unknown;
    _dirtyEnd?: unknown;
    _version?: unknown;
  };
  if (
    !(candidate._instances instanceof Float32Array) ||
    !(candidate._runRecords instanceof Map) ||
    !Array.isArray(candidate._groups) ||
    typeof candidate._instanceCount !== "number" ||
    typeof candidate._dirtyStart !== "number" ||
    typeof candidate._dirtyEnd !== "number" ||
    typeof candidate._version !== "number"
  ) return false;

  const record = candidate._runRecords.get(patch.run);
  if (!isRecord(record) || !Array.isArray(record.slots) ||
      typeof record.groupIdx !== "number") {
    return false;
  }
  const group = candidate._groups[record.groupIdx];
  if (!isRecord(group) || !isRecord(group.curveSet) ||
      !(group.curveSet.curves instanceof Map) || !isRecord(group.curveSet.atlas) ||
      !(group.curveSet.atlas.glyphSlots instanceof Map)) {
    return false;
  }
  const slots = record.slots as unknown[];
  const resolved: Array<{
    slot: number;
    glyph: PlacedGlyph;
    curves: { bounds: { xMin: number; yMin: number; xMax: number; yMax: number } };
    atlas: {
      glyphLocX: number;
      glyphLocY: number;
      bandMaxX: number;
      bandMaxY: number;
      vBandCount: number;
      hBandCount: number;
    };
  }> = [];
  let liveIndex = 0;
  for (const glyph of patch.glyphs) {
    const curves = group.curveSet.curves.get(glyph.glyphId);
    const atlas = group.curveSet.atlas.glyphSlots.get(glyph.glyphId);
    // Lite omits non-drawing glyphs such as spaces from a run's live slots.
    if (curves === undefined && atlas === undefined) continue;
    const slot = slots[liveIndex++];
    if (!Number.isInteger(slot) || (slot as number) < 0 ||
        (slot as number) >= candidate._instanceCount ||
        !isGlyphCurves(curves) || !isAtlasSlot(atlas)) {
      return false;
    }
    resolved.push({ slot: slot as number, glyph, curves, atlas });
  }
  if (liveIndex !== slots.length) return false;

  const instances = candidate._instances;
  const invScale = patch.pixelsPerFontUnit !== 0 ? 1 / patch.pixelsPerFontUnit : 0;
  let dirtyStart = Number.POSITIVE_INFINITY;
  let dirtyEnd = -1;
  for (const item of resolved) {
    const { xMin, yMin, xMax, yMax } = item.curves.bounds;
    const width = xMax - xMin;
    const height = yMax - yMin;
    const bandScaleX = width > 0 ? item.atlas.vBandCount / width : 0;
    const bandScaleY = height > 0 ? item.atlas.hBandCount / height : 0;
    const base = item.slot * 20;
    instances[base] = xMin;
    instances[base + 1] = yMin;
    instances[base + 2] = xMax;
    instances[base + 3] = yMax;
    instances[base + 4] = item.glyph.x + patch.offsetX;
    instances[base + 5] = item.glyph.y + patch.offsetY;
    instances[base + 6] = invScale;
    instances[base + 7] = 0;
    instances[base + 8] = item.atlas.glyphLocX;
    instances[base + 9] = item.atlas.glyphLocY;
    instances[base + 10] = item.atlas.bandMaxX;
    instances[base + 11] = item.atlas.bandMaxY;
    instances[base + 12] = bandScaleX;
    instances[base + 13] = bandScaleY;
    instances[base + 14] = -xMin * bandScaleX;
    instances[base + 15] = -yMin * bandScaleY;
    instances[base + 16] = patch.color[0];
    instances[base + 17] = patch.color[1];
    instances[base + 18] = patch.color[2];
    instances[base + 19] = patch.color[3];
    dirtyStart = Math.min(dirtyStart, item.slot);
    dirtyEnd = Math.max(dirtyEnd, item.slot + 1);
  }
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
 * Guarded Babylon Lite 1.14 bridge. Translates existing glyph slots in place
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
    if (!isRecord(record) || !Array.isArray(record.slots)) return false;
    const slots = record.slots;
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
      const base = slot * 20;
      instances[base + 4] = (instances[base + 4] ?? 0) + translation.dx;
      instances[base + 5] = (instances[base + 5] ?? 0) + translation.dy;
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

function isGlyphCurves(value: unknown): value is {
  bounds: { xMin: number; yMin: number; xMax: number; yMax: number };
} {
  if (!isRecord(value) || !isRecord(value.bounds)) return false;
  const bounds = value.bounds;
  return ["xMin", "yMin", "xMax", "yMax"].every((key) =>
    typeof bounds[key] === "number" && Number.isFinite(bounds[key])
  );
}

function isAtlasSlot(value: unknown): value is {
  glyphLocX: number;
  glyphLocY: number;
  bandMaxX: number;
  bandMaxY: number;
  vBandCount: number;
  hBandCount: number;
} {
  if (!isRecord(value)) return false;
  return ["glyphLocX", "glyphLocY", "bandMaxX", "bandMaxY", "vBandCount", "hBandCount"].every((key) =>
    typeof value[key] === "number" && Number.isFinite(value[key])
  );
}

function isFiniteNonNegative(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}
