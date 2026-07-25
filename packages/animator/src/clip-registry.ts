import type { AnimationGroup } from "@babylonjs/lite";
import { AnimatorError } from "./errors.js";
import type {
  ClipRegistry,
  ClipRegistryEntry,
  ClipRegistryOptions
} from "./types.js";

interface InternalClipRegistry extends ClipRegistry {
  readonly byId: ReadonlyMap<string, ClipRegistryEntry>;
}

/**
 * Builds an immutable lookup table for source clip names and optional semantic aliases.
 *
 * @throws {@link AnimatorError} when source names or resulting IDs are duplicated, empty,
 * or an alias references a source group that does not exist.
 */
export function createClipRegistry(
  groups: readonly AnimationGroup[],
  options: ClipRegistryOptions = {}
): ClipRegistry {
  const sourceNames = new Map<string, AnimationGroup>();
  for (const group of groups) {
    const name = group.name.trim();
    if (!name) {
      throw new AnimatorError("duplicate-clip", "Animation groups require non-empty names.");
    }
    if (sourceNames.has(name)) {
      throw new AnimatorError(
        "duplicate-clip",
        `Duplicate animation group name "${name}".`,
        { sourceName: name }
      );
    }
    sourceNames.set(name, group);
  }

  const entries: ClipRegistryEntry[] = [];
  const byId = new Map<string, ClipRegistryEntry>();
  for (const [sourceName, group] of sourceNames) {
    addEntry(byId, entries, sourceName, sourceName, group);
  }

  for (const [id, sourceName] of Object.entries(options.aliases ?? {})) {
    if (!id.trim()) {
      throw new AnimatorError("invalid-alias", "Animation aliases require non-empty IDs.");
    }
    const group = sourceNames.get(sourceName);
    if (!group) {
      throw new AnimatorError(
        "invalid-alias",
        `Animation alias "${id}" references unknown source "${sourceName}".`,
        { id, sourceName }
      );
    }
    addEntry(byId, entries, id, sourceName, group);
  }

  return Object.freeze({
    entries: Object.freeze(entries),
    size: entries.length,
    byId
  } satisfies InternalClipRegistry);
}

/** Returns the registry entry for a source name or semantic alias. */
export function getClipRegistryEntry(
  registry: ClipRegistry,
  id: string
): ClipRegistryEntry | undefined {
  return asRegistry(registry).byId.get(id);
}

/** Tests whether a value has the public shape of a clip registry. */
export function isClipRegistry(value: unknown): value is ClipRegistry {
  return (
    typeof value === "object" &&
    value !== null &&
    Array.isArray((value as Partial<ClipRegistry>).entries) &&
    typeof (value as Partial<ClipRegistry>).size === "number"
  );
}

function addEntry(
  byId: Map<string, ClipRegistryEntry>,
  entries: ClipRegistryEntry[],
  id: string,
  sourceName: string,
  group: AnimationGroup
): void {
  if (byId.has(id)) {
    throw new AnimatorError("duplicate-clip", `Duplicate animation clip ID "${id}".`, { id });
  }
  const entry = Object.freeze({ id, sourceName, group });
  byId.set(id, entry);
  entries.push(entry);
}

function asRegistry(registry: ClipRegistry): InternalClipRegistry {
  const internal = registry as Partial<InternalClipRegistry>;
  if (!(internal.byId instanceof Map)) {
    const byId = new Map(registry.entries.map((entry) => [entry.id, entry]));
    return { entries: registry.entries, size: registry.size, byId };
  }
  return internal as InternalClipRegistry;
}
