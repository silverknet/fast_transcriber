/** Top-level `formatVersion` on `SongMap` JSON. Bump when breaking on-disk shape. */
export const SONGMAP_FORMAT_VERSION = 3 as const
export const SONGMAP_LEGACY_FORMAT_VERSION = 1 as const
export const SONGMAP_CUE_TRACK_FORMAT_VERSION = 2 as const

/** Human-readable notes for maintainers (not serialized). */
export const SONGMAP_VERSION_CHANGELOG: string[] = [
  'v1: bar-first timeline, flat beats with barId, harmony events, sections, cue settings, audio reference.',
  'v2: canonical cueTracks[], clickExport, and v1 cue-field migration on load.',
  'v3: shared reversible song transposition; source harmony/audio remain untransposed.',
]
