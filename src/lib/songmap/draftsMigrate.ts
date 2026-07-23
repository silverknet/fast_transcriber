/**
 * v5 → v6 migration: two name-paired layer stacks → one list of drafts.
 *
 * v5 kept `chordLayers[]` and `sectionLayers[]` as INDEPENDENT stacks, related
 * only by a matching `name` string. The two sides disambiguated duplicate names
 * separately, so the pairing drifted apart in practice — a real project carried
 * five chord layers (`Sheet import`, `Sheet import 2`, `Sheet import 3`,
 * `Sheet import 3 2`, `My chords`) against three section layouts
 * (`My sections`, `Sheet import`, `Sheet import 2`), with the ACTIVE chord
 * track's name colliding with a different stored layer of the same name.
 *
 * The migration is LOSSLESS: every layer on either side survives as a named
 * draft. Layers whose names match are paired; a layer with no partner still
 * becomes a draft, with its missing side copied from the ACTIVE draft so no
 * draft is left half-empty. v5's single shared `lyrics` is copied into every
 * draft, since v6 makes lyrics part of a draft.
 *
 * DETERMINISM IS LOAD-BEARING. Cloud rows are migrated at the read boundary on
 * every device (`normalizeCloudSongMap`), and `collabContentFingerprint()`
 * hashes the result. If this function minted random ids or `new Date()`
 * timestamps, two devices would migrate the same row to different bytes,
 * diverge on the fingerprint, and push each other in a loop — the failure mode
 * commit 174610c fixed for legacy cue tracks. So: ids come from the existing
 * layer ids, the active draft gets a fixed derived id, and no timestamp is
 * invented.
 */
import { DEFAULT_DRAFT_NAME, makeDraft } from './drafts'
import type { ChordLayer, HarmonyEvent, Lyrics, Section, SectionLayer, SongDraft } from './types'

/**
 * Stable id for the draft holding the migrated ACTIVE content. Fixed rather
 * than random so the migration is byte-deterministic across devices; collisions
 * with a real layer id are resolved by suffixing (see `resolveActiveId`).
 */
export const MIGRATED_ACTIVE_DRAFT_ID = 'draft-migrated-active'

export type LegacyLayerInput = {
  sections: Section[]
  harmony: HarmonyEvent[]
  lyrics?: Lyrics
  chordLayers?: ChordLayer[]
  sectionLayers?: SectionLayer[]
  activeChordLayerName?: string
  activeSectionLayerName?: string
}

export type MigratedDrafts = {
  drafts?: SongDraft[]
  activeDraftId: string
  activeDraftName: string
}

function cloneSections(sections: Section[]): Section[] {
  return sections.map((s) => ({ ...s, barRange: { ...s.barRange } }))
}

function cloneHarmony(harmony: HarmonyEvent[]): HarmonyEvent[] {
  return harmony.map((h) => ({ ...h }))
}

function cloneLyrics(lyrics: Lyrics | undefined): Lyrics | undefined {
  return lyrics ? { ...lyrics, words: lyrics.words.map((w) => ({ ...w })) } : undefined
}

/** Keep the fixed active id clear of any real layer id already in the file. */
function resolveActiveId(taken: Set<string>): string {
  if (!taken.has(MIGRATED_ACTIVE_DRAFT_ID)) return MIGRATED_ACTIVE_DRAFT_ID
  for (let i = 2; ; i++) {
    const candidate = `${MIGRATED_ACTIVE_DRAFT_ID}-${i}`
    if (!taken.has(candidate)) return candidate
  }
}

function uniqueName(taken: Set<string>, base: string): string {
  if (!taken.has(base)) {
    taken.add(base)
    return base
  }
  for (let i = 2; ; i++) {
    const candidate = `${base} ${i}`
    if (!taken.has(candidate)) {
      taken.add(candidate)
      return candidate
    }
  }
}

/**
 * Fold v5 layer stacks into v6 drafts. Returns the ACTIVE draft's identity plus
 * the stored INACTIVE drafts — the active draft's CONTENT stays at the SongMap
 * root and is not repeated here.
 */
export function migrateLayersToDrafts(input: LegacyLayerInput): MigratedDrafts {
  const chordLayers = input.chordLayers ?? []
  const sectionLayers = input.sectionLayers ?? []

  const takenIds = new Set<string>([
    ...chordLayers.map((l) => l.id),
    ...sectionLayers.map((l) => l.id),
  ])
  const activeDraftId = resolveActiveId(takenIds)

  // The active draft keeps whichever name v5 displayed. When the two sides
  // disagreed, the chord track's name wins — it is the one the chord picker
  // showed, and chords are the side users named deliberately.
  const activeDraftName =
    input.activeChordLayerName ?? input.activeSectionLayerName ?? DEFAULT_DRAFT_NAME

  const takenNames = new Set<string>([activeDraftName])
  const sharedLyrics = cloneLyrics(input.lyrics)
  const drafts: SongDraft[] = []

  // Pass 1: chord layers, each claiming the same-named section layer if one is
  // still unclaimed. Unmatched chord layers inherit the ACTIVE sections.
  const claimedSectionLayerIds = new Set<string>()
  for (const cl of chordLayers) {
    const partner = sectionLayers.find(
      (sl) => sl.name === cl.name && !claimedSectionLayerIds.has(sl.id),
    )
    if (partner) claimedSectionLayerIds.add(partner.id)

    drafts.push(
      makeDraft({
        id: cl.id,
        name: uniqueName(takenNames, cl.name),
        source: partner?.source ?? cl.source ?? 'manual',
        createdAt: cl.createdAt ?? partner?.createdAt,
        sections: cloneSections(partner ? partner.sections : input.sections),
        harmony: cloneHarmony(cl.harmony),
        lyrics: cloneLyrics(sharedLyrics),
      }),
    )
  }

  // Pass 2: section layers nobody claimed. They inherit the ACTIVE chords.
  for (const sl of sectionLayers) {
    if (claimedSectionLayerIds.has(sl.id)) continue
    drafts.push(
      makeDraft({
        id: sl.id,
        name: uniqueName(takenNames, sl.name),
        source: sl.source ?? 'manual',
        createdAt: sl.createdAt,
        sections: cloneSections(sl.sections),
        harmony: cloneHarmony(input.harmony),
        lyrics: cloneLyrics(sharedLyrics),
      }),
    )
  }

  return {
    drafts: drafts.length > 0 ? drafts : undefined,
    activeDraftId,
    activeDraftName,
  }
}
