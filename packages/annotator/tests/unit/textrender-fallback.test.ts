import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createFontFromBuffer, type SurfaceContext } from "@babylonjs/lite";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AnnotationId, BackendAnnotationDefinition } from "../../src/types.js";

const privateLayout = vi.fn();

vi.mock("../../src/textrender-private.js", () => ({
  guardedPrivateLayoutText: privateLayout
}));

const { createTextRendererAnnotationBackend } = await import("../../src/textrender.js");

const fontBytes = readFileSync(fileURLToPath(new URL("../../examples/textrender/assets/InterVariable.ttf", import.meta.url)));
const fontBuffer = fontBytes.buffer.slice(fontBytes.byteOffset, fontBytes.byteOffset + fontBytes.byteLength);
const font = createFontFromBuffer(fontBuffer);

describe("TextRenderer guarded-private fallback", () => {
  beforeEach(() => {
    privateLayout.mockReset();
  });

  it.each([
    ["throws", () => { throw new Error("private layout failed"); }],
    ["returns a malformed layout", () => ({ glyphs: null })]
  ])("permanently disables the private adapter when it %s", (_case, failure) => {
    privateLayout.mockImplementation(failure);
    const surface = {
      canvas: { width: 200, height: 100 },
      format: "bgra8unorm",
      _renderingContexts: []
    } as unknown as SurfaceContext;
    (surface as unknown as { engine: SurfaceContext }).engine = surface;
    const backend = createTextRendererAnnotationBackend({
      surface,
      font,
      shapingMode: "guarded-private"
    });

    backend.create(label("First", 1));
    backend.create(label("Second", 2));

    expect(privateLayout).toHaveBeenCalledTimes(1);
    expect(backend.getStats()).toMatchObject({
      privateAdapterAvailable: false,
      privateShapes: 0,
      privateFallbacks: 1,
      publicShapes: 2
    });
    backend.dispose();
  });
});

function label(text: string, id: number): BackendAnnotationDefinition {
  return { id: id as AnnotationId, type: "label", text, zIndex: 0, style: {} };
}
