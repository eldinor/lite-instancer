import { describe, expect, it } from "vitest";
import { createHtmlAnnotationBackend } from "../../src/html.js";
import type { AnnotationId, BackendAnnotationDefinition } from "../../src/types.js";

describe("HTML leader-line caps", () => {
  it("uses square caps by default and applies explicit round caps", () => {
    const document = new FakeDocument();
    const container = new FakeElement(document);
    const backend = createHtmlAnnotationBackend({ container: container as never });
    const square = backend.create(label({ width: 2 }));
    expect(lineFor(square).getAttribute("stroke-linecap")).toBe("square");
    const round = backend.create(label({ width: 2, lineCap: "round" }, 2));
    expect(lineFor(round).getAttribute("stroke-linecap")).toBe("round");
    backend.dispose();
  });
});

function label(leaderLine: NonNullable<BackendAnnotationDefinition["leaderLine"]>, id = 1): BackendAnnotationDefinition {
  return { id: id as AnnotationId, type: "label", text: "Line", zIndex: 0, style: {}, leaderLine };
}

function lineFor(resource: unknown): FakeElement {
  return (resource as { leaderLine: FakeElement }).leaderLine;
}

class FakeDocument {
  createElement(): FakeElement { return new FakeElement(this); }
  createElementNS(): FakeElement { return new FakeElement(this); }
}

class FakeElement {
  readonly ownerDocument: FakeDocument;
  readonly style: Record<string, string> = {};
  readonly dataset: Record<string, string> = {};
  readonly children: FakeElement[] = [];
  readonly classList = { add() {}, remove() {} };
  readonly attributes = new Map<string, string>();
  className = "";
  textContent = "";
  hidden = false;
  tabIndex = -1;
  scrollLeft = 0;
  scrollTop = 0;
  clientLeft = 0;
  clientTop = 0;

  constructor(document: FakeDocument) { this.ownerDocument = document; }
  append(...elements: FakeElement[]): void { this.children.push(...elements); }
  remove(): void {}
  setAttribute(name: string, value: string): void { this.attributes.set(name, value); }
  getAttribute(name: string): string | null { return this.attributes.get(name) ?? null; }
  removeAttribute(name: string): void { this.attributes.delete(name); }
  addEventListener(): void {}
  getBoundingClientRect(): DOMRect { return { left: 0, top: 0, width: 0, height: 0 } as DOMRect; }
}
