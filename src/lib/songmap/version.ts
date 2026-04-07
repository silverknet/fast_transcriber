/** Top-level `formatVersion` on `SongMap` JSON. Bump when breaking on-disk shape. */
export const SONGMAP_FORMAT_VERSION = 1 as const

/** Human-readable notes for maintainers (not serialized). */
export const SONGMAP_VERSION_CHANGELOG: string[] = [
  'v1: bar-first timeline, flat beats with barId, harmony events, sections, cue settings, audio reference.',
]
