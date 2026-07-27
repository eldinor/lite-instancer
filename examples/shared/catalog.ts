export const EXAMPLE_CATEGORIES = [
  "Core",
  "Hierarchies",
  "VAT animation",
  "Characters & attachments",
  "Scale & tooling"
] as const;

export type ExampleCategory = (typeof EXAMPLE_CATEGORIES)[number];

export interface ExampleCatalogEntry {
  readonly id: string;
  readonly title: string;
  readonly description: string;
  readonly category: ExampleCategory;
  readonly tags: readonly string[];
}

export const EXAMPLES: readonly ExampleCatalogEntry[] = [
  example("basic-thin-instances", "Basic thin instances", "Stable IDs, transforms, colors, removal, and creation.", "Core", ["stable IDs", "transforms"]),
  example("primitive-box-field", "Primitive box field", "Boxes, colors, batched transforms, and selection.", "Core", ["batching", "picking"]),
  example("primitive-sphere-cloud", "Primitive sphere cloud", "Metadata queries, group visibility, and motion.", "Core", ["metadata", "visibility"]),
  example("primitive-mixed-playground", "Mixed primitive playground", "Several primitive sets sharing one picking flow.", "Core", ["multiple sets", "picking"]),
  example("visibility-layers", "Visibility strategies", "Compare active-count packing with scale-zero slots.", "Core", ["visibility", "slots"]),
  example("raw-batch-streaming", "Raw batch streaming", "Compare the batch writer with controlled raw-buffer edits.", "Core", ["streaming", "raw buffers"]),

  example("boombox-grid", "BoomBox hierarchy grid", "GLB hierarchy instances with picking, creation, and removal.", "Hierarchies", ["GLB", "picking"]),
  example("boombox-picker", "BoomBox stable picking", "Delete picked hierarchy instances safely after slot swaps.", "Hierarchies", ["GLB", "stable IDs"]),
  example("boombox-rebuild-growth", "Hierarchy rebuild growth", "Grow a hierarchy pool by rebuilding while IDs survive.", "Hierarchies", ["growth", "pooling"]),

  example("shark-school-shared-animation", "Shared shark animation", "A GLB school driven by one shared animation phase.", "VAT animation", ["VAT", "shared phase"]),
  example("shark-phase-buckets", "Shark phase buckets", "Per-instance phase and FPS variation across a VAT school.", "VAT animation", ["VAT", "phase"]),
  example("shark-clip-mixer", "Shark clip mixer", "Assign clips per instance and control a selected shark.", "VAT animation", ["VAT", "clips"]),
  example("dist-vat-acrobatic-plane", "Published-package VAT plane", "Import the built package and animate acrobatic plane instances.", "VAT animation", ["dist import", "VAT"]),

  example("xbot-basic-animation", "Ready Player animation", "Load and loop the supplied animated Ready Player GLB.", "Characters & attachments", ["GLB", "skeleton"]),
  example("xbot-vat-sword-sync", "Ready Player sword sync", "Synchronize thin sword instances with VAT avatar hands.", "Characters & attachments", ["VAT", "sockets"]),
  example("samba-girl-vat-sword-sync", "Samba sword sync", "Synchronize swords across glTF right-handed to Lite left-handed conversion.", "Characters & attachments", ["VAT", "basis conversion"]),
  example("glb-vat-socket-configurator", "VAT socket configurator", "Tune attachment transforms and export JSON or TypeScript.", "Characters & attachments", ["editor", "sockets"]),

  example("unarmed-vat-arena", "Unarmed VAT arena", "A 3,000-capacity crowd split across independently baked groups.", "Scale & tooling", ["crowd", "VAT"]),
  example("massive-avatar-arena", "Massive avatar arena", "A multi-species crowd benchmark with actions, selection, and outlines.", "Scale & tooling", ["benchmark", "crowd"]),
  example("thin-instance-outlines", "Outline gallery", "Highlight primitives and imported or animated assets with the standalone API.", "Scale & tooling", ["outlines", "selection"])
];

export function examplePath(entry: ExampleCatalogEntry): string {
  return `/examples/${entry.id}/`;
}

export function getExampleNeighbors(id: string): {
  readonly previous?: ExampleCatalogEntry;
  readonly next?: ExampleCatalogEntry;
} {
  const index = EXAMPLES.findIndex((entry) => entry.id === id);
  if (index < 0) return {};
  return {
    ...(index > 0 ? { previous: EXAMPLES[index - 1] } : {}),
    ...(index + 1 < EXAMPLES.length ? { next: EXAMPLES[index + 1] } : {})
  };
}

function example(
  id: string,
  title: string,
  description: string,
  category: ExampleCategory,
  tags: readonly string[]
): ExampleCatalogEntry {
  return Object.freeze({ id, title, description, category, tags: Object.freeze(tags.slice()) });
}
