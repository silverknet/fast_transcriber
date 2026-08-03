import { describe, expect, it } from 'vitest'
import {
  DEFAULT_DRAFT_NAME,
  addDraftAndActivate,
  deleteDraft,
  duplicateActiveDraft,
  ensureActiveDraftIdentity,
  listDrafts,
  renameDraft,
  switchToDraft,
} from './drafts'
import { MIGRATED_ACTIVE_DRAFT_ID, migrateLayersToDrafts } from './draftsMigrate'
import { createEmptySongMap } from './factory'
import { parseSongMap } from './parse'
import { validateSongMap } from './validate'
import { SONGMAP_FORMAT_VERSION } from './version'
import type { ChordLayer, HarmonyEvent, Lyrics, Section, SectionLayer, SongMap } from './types'

let idCounter = 0
const newId = (): string => `id${++idCounter}`

function section(id: string, start: number, end: number, label = 'Verse'): Section {
  return { id, kind: 'verse', label, barRange: { startBarIndex: start, endBarIndex: end } }
}

function chord(id: string, displayRaw: string): HarmonyEvent {
  return {
    id,
    barId: 'bar0',
    beatId: `beat-${id}`,
    startSec: 0,
    endSec: 1,
    chord: { root: 'C', quality: 'maj', displayRaw },
  }
}

function lyrics(text: string): Lyrics {
  return { words: [{ text, startSec: 0, endSec: 1, line: 0 }], sourceText: text }
}

function baseMap(): SongMap {
  idCounter = 0
  return {
    ...createEmptySongMap({ now: () => '2020-01-01T00:00:00.000Z' }),
    sections: [section('sec-a', 0, 3, 'Verse A')],
    harmony: [chord('ch-a', 'C')],
    lyrics: lyrics('hello'),
  }
}

describe('drafts — the active draft lives at the root', () => {
  it('listDrafts shows every draft exactly once, with one marked active', () => {
    const map = ensureActiveDraftIdentity(baseMap(), newId)
    const withSecond = addDraftAndActivate(
      map,
      { sections: [section('sec-b', 4, 7)], harmony: [chord('ch-b', 'G')], lyrics: undefined },
      'Sheet import',
      newId,
    )
    const rows = listDrafts(withSecond)
    expect(rows).toHaveLength(2)
    expect(rows.filter((r) => r.active)).toHaveLength(1)
    expect(rows.find((r) => r.active)!.name).toBe('Sheet import')
    // The active draft is NOT duplicated into storage.
    expect(withSecond.drafts?.some((d) => d.id === withSecond.activeDraftId)).toBe(false)
  })

  it('listDrafts order does not change when the selection changes', () => {
    // The switcher is a radio list: reordering on select would move rows out
    // from under the user's cursor mid-click.
    const map = ensureActiveDraftIdentity(baseMap(), newId)
    const withSecond = addDraftAndActivate(
      map,
      { sections: [section('sec-b', 4, 7)], harmony: [chord('ch-b', 'G')], lyrics: undefined },
      'Sheet import',
      newId,
    )
    const before = listDrafts(withSecond).map((r) => r.name)
    const other = listDrafts(withSecond).find((r) => !r.active)!
    const switched = switchToDraft(withSecond, other.id, newId)
    expect(switched.ok).toBe(true)
    if (!switched.ok) return
    expect(listDrafts(switched.map).map((r) => r.name)).toEqual(before)
    // ...and the selection really did move.
    expect(listDrafts(switched.map).find((r) => r.active)!.name).toBe(other.name)
  })

  it('validate rejects an active draft that is also stored (two sources of truth)', () => {
    const map = ensureActiveDraftIdentity(baseMap(), newId)
    const broken: SongMap = {
      ...map,
      activeDraftId: 'dup',
      drafts: [{ id: 'dup', name: 'Dup', sections: [], harmony: [] }],
    }
    const res = validateSongMap(broken)
    expect(res.ok).toBe(false)
    expect(res.ok === false && res.errors.join(' ')).toContain('active draft must not be stored')
  })
})

describe('drafts — switching is lossless in both directions', () => {
  it('switching swaps sections, chords AND lyrics together', () => {
    const start = ensureActiveDraftIdentity(baseMap(), newId)
    const firstId = start.activeDraftId!

    const imported = addDraftAndActivate(
      start,
      {
        sections: [section('sec-b', 4, 7, 'Chorus B')],
        harmony: [chord('ch-b', 'G')],
        lyrics: lyrics('world'),
      },
      'Sheet import',
      newId,
    )
    expect(imported.sections[0].label).toBe('Chorus B')
    expect(imported.harmony[0].chord.displayRaw).toBe('G')
    expect(imported.lyrics?.sourceText).toBe('world')

    // Switch back to the original draft.
    const back = switchToDraft(imported, firstId, newId)
    expect(back.ok).toBe(true)
    if (!back.ok) return
    expect(back.map.sections[0].label).toBe('Verse A')
    expect(back.map.harmony[0].chord.displayRaw).toBe('C')
    expect(back.map.lyrics?.sourceText).toBe('hello')
    // The import is preserved, not discarded.
    expect(back.map.drafts?.map((d) => d.name)).toEqual(['Sheet import'])
  })

  it('round-tripping A → B → A restores the original content exactly', () => {
    const start = ensureActiveDraftIdentity(baseMap(), newId)
    const firstId = start.activeDraftId!
    const imported = addDraftAndActivate(
      start,
      { sections: [section('sec-b', 4, 7)], harmony: [chord('ch-b', 'G')], lyrics: lyrics('two') },
      'Second',
      newId,
    )
    const secondId = imported.activeDraftId!
    const there = switchToDraft(imported, firstId, newId)
    expect(there.ok).toBe(true)
    if (!there.ok) return
    const backAgain = switchToDraft(there.map, secondId, newId)
    expect(backAgain.ok).toBe(true)
    if (!backAgain.ok) return
    expect(backAgain.map.sections).toEqual(imported.sections)
    expect(backAgain.map.harmony).toEqual(imported.harmony)
    expect(backAgain.map.lyrics).toEqual(imported.lyrics)
  })

  it('switching does not mutate the source map (no aliasing of section ranges)', () => {
    const start = ensureActiveDraftIdentity(baseMap(), newId)
    const firstId = start.activeDraftId!
    const imported = addDraftAndActivate(
      start,
      { sections: [section('sec-b', 4, 7)], harmony: [], lyrics: undefined },
      'Second',
      newId,
    )
    const back = switchToDraft(imported, firstId, newId)
    expect(back.ok).toBe(true)
    if (!back.ok) return
    back.map.sections[0].barRange.startBarIndex = 99
    const stored = back.map.drafts?.find((d) => d.name === 'Second')
    expect(stored?.sections[0].barRange.startBarIndex).toBe(4)
  })

  it('switching to the already-active draft is a no-op', () => {
    const start = ensureActiveDraftIdentity(baseMap(), newId)
    const res = switchToDraft(start, start.activeDraftId!, newId)
    expect(res.ok).toBe(true)
    if (!res.ok) return
    expect(res.map).toBe(start)
  })

  it('an empty outgoing draft is dropped rather than stored as a shell', () => {
    const empty = ensureActiveDraftIdentity(
      { ...createEmptySongMap({ now: () => '2020-01-01T00:00:00.000Z' }) },
      newId,
    )
    const imported = addDraftAndActivate(
      empty,
      { sections: [section('s', 0, 1)], harmony: [], lyrics: undefined },
      'Sheet import',
      newId,
    )
    expect(imported.drafts).toBeUndefined()
  })
})

describe('drafts — naming, duplication and deletion', () => {
  it('duplicate names are disambiguated against the active draft too', () => {
    let map = ensureActiveDraftIdentity(baseMap(), newId)
    map = renameDraft(map, map.activeDraftId!, 'Sheet import')
    map = addDraftAndActivate(
      map,
      { sections: [], harmony: [chord('ch-b', 'G')], lyrics: undefined },
      'Sheet import',
      newId,
    )
    expect(map.activeDraftName).toBe('Sheet import 2')
    expect(map.drafts?.map((d) => d.name)).toEqual(['Sheet import'])
  })

  it('duplicating copies content and leaves the original intact', () => {
    const start = ensureActiveDraftIdentity(baseMap(), newId)
    const dup = duplicateActiveDraft(start, 'My draft copy', newId)
    expect(dup.activeDraftName).toBe('My draft copy')
    expect(dup.sections).toEqual(start.sections)
    expect(dup.harmony).toEqual(start.harmony)
    expect(dup.drafts?.[0].sections).toEqual(start.sections)
    expect(dup.activeDraftId).not.toBe(dup.drafts?.[0].id)
  })

  it('the active draft cannot be deleted', () => {
    const start = ensureActiveDraftIdentity(baseMap(), newId)
    const after = deleteDraft(start, start.activeDraftId!)
    expect(after.sections).toEqual(start.sections)
    expect(after.activeDraftId).toBe(start.activeDraftId)
  })

  it('deleting a stored draft leaves the active one untouched', () => {
    const start = ensureActiveDraftIdentity(baseMap(), newId)
    const imported = addDraftAndActivate(
      start,
      { sections: [], harmony: [chord('ch-b', 'G')], lyrics: undefined },
      'Second',
      newId,
    )
    const storedId = imported.drafts![0].id
    const after = deleteDraft(imported, storedId)
    expect(after.drafts).toBeUndefined()
    expect(after.harmony[0].chord.displayRaw).toBe('G')
  })
})

describe('v5 → v6 migration', () => {
  function chordLayer(id: string, name: string, symbols: string[]): ChordLayer {
    return { id, name, harmony: symbols.map((s, i) => chord(`${id}-${i}`, s)) }
  }
  function sectionLayer(id: string, name: string, labels: string[]): SectionLayer {
    return { id, name, sections: labels.map((l, i) => section(`${id}-${i}`, i, i, l)) }
  }

  it('pairs layers with matching names into one draft', () => {
    const res = migrateLayersToDrafts({
      sections: [section('active-sec', 0, 3, 'Active')],
      harmony: [chord('active-ch', 'C')],
      chordLayers: [chordLayer('cl1', 'Sheet import', ['G', 'D'])],
      sectionLayers: [sectionLayer('sl1', 'Sheet import', ['Verse', 'Chorus'])],
      activeChordLayerName: 'My chords',
      activeSectionLayerName: 'My sections',
    })
    expect(res.activeDraftName).toBe('My chords')
    expect(res.drafts).toHaveLength(1)
    expect(res.drafts![0].name).toBe('Sheet import')
    expect(res.drafts![0].harmony.map((h) => h.chord.displayRaw)).toEqual(['G', 'D'])
    expect(res.drafts![0].sections.map((s) => s.label)).toEqual(['Verse', 'Chorus'])
  })

  it("Bröllopsgig's real mismatched layers migrate losslessly", () => {
    // Verbatim from "Love never felt so good": five chord layers against three
    // section layouts, with the ACTIVE chord track's name colliding with a
    // different stored layer of the same name.
    const res = migrateLayersToDrafts({
      sections: [section('active-sec', 0, 3, 'ActiveSection')],
      harmony: [chord('active-ch', 'C')],
      lyrics: lyrics('shared lyrics'),
      chordLayers: [
        chordLayer('c1', 'Sheet import', ['G']),
        chordLayer('c2', 'Sheet import 3 2', ['A']),
        chordLayer('c3', 'Sheet import 2', ['B']),
        chordLayer('c4', 'My chords', ['C']),
        chordLayer('c5', 'Sheet import 3', ['D']),
      ],
      sectionLayers: [
        sectionLayer('s1', 'My sections', ['Intro']),
        sectionLayer('s2', 'Sheet import', ['Verse']),
        sectionLayer('s3', 'Sheet import 2', ['Chorus']),
      ],
      activeChordLayerName: 'Sheet import',
      activeSectionLayerName: 'Sheet import',
    })

    // Every layer on either side survives: 5 chord + 3 section, of which 2
    // pair up by name → 6 stored drafts, plus the active one.
    expect(res.drafts).toHaveLength(6)
    expect(res.activeDraftName).toBe('Sheet import')

    // No draft is lost and no name collides.
    const names = res.drafts!.map((d) => d.name)
    expect(new Set(names).size).toBe(names.length)
    expect(names).not.toContain('Sheet import') // taken by the active draft
    expect(names).toContain('Sheet import 2')

    // Paired names carry BOTH sides.
    const paired = res.drafts!.find((d) => d.harmony[0]?.chord.displayRaw === 'B')!
    expect(paired.sections.map((s) => s.label)).toEqual(['Chorus'])

    // A chord layer with no section partner inherits the ACTIVE sections
    // rather than being left half-empty.
    const orphanChords = res.drafts!.find((d) => d.harmony[0]?.chord.displayRaw === 'A')!
    expect(orphanChords.sections.map((s) => s.label)).toEqual(['ActiveSection'])

    // A section layout with no chord partner inherits the ACTIVE chords.
    const orphanSections = res.drafts!.find((d) => d.name === 'My sections')!
    expect(orphanSections.harmony.map((h) => h.chord.displayRaw)).toEqual(['C'])

    // v5's single shared lyrics becomes per-draft.
    for (const d of res.drafts!) expect(d.lyrics?.sourceText).toBe('shared lyrics')
  })

  it('is deterministic — two devices migrate the same row to identical bytes', () => {
    const input = {
      sections: [section('active-sec', 0, 3)],
      harmony: [chord('active-ch', 'C')],
      chordLayers: [chordLayer('c1', 'Sheet import', ['G'])],
      sectionLayers: [sectionLayer('s1', 'My sections', ['Intro'])],
      activeChordLayerName: 'My chords',
    }
    const a = migrateLayersToDrafts(input)
    const b = migrateLayersToDrafts(input)
    expect(JSON.stringify(a)).toBe(JSON.stringify(b))
    expect(a.activeDraftId).toBe(MIGRATED_ACTIVE_DRAFT_ID)
  })

  it('a v5 file with no layers migrates to a single named draft', () => {
    const res = migrateLayersToDrafts({
      sections: [section('a', 0, 1)],
      harmony: [chord('b', 'C')],
    })
    expect(res.drafts).toBeUndefined()
    expect(res.activeDraftName).toBe(DEFAULT_DRAFT_NAME)
  })
})

describe('parse — version ladder', () => {
  /** No `beatId`: these fixtures have an empty timeline, and validation
   *  (correctly) rejects a chord anchored to a beat that doesn't exist. */
  function looseChord(id: string, displayRaw: string): HarmonyEvent {
    const { beatId: _beatId, ...rest } = chord(id, displayRaw)
    return rest
  }

  function v5Json(extra: Record<string, unknown>): string {
    const base = createEmptySongMap({ now: () => '2020-01-01T00:00:00.000Z' })
    return JSON.stringify({
      ...base,
      formatVersion: 5,
      activeDraftId: undefined,
      activeDraftName: undefined,
      ...extra,
    })
  }

  it('reads a v5 file and folds its layers into drafts', () => {
    const json = v5Json({
      sections: [section('active-sec', 0, 3, 'Active')],
      harmony: [looseChord('active-ch', 'C')],
      chordLayers: [{ id: 'c1', name: 'Sheet import', harmony: [looseChord('c1-0', 'G')] }],
      sectionLayers: [{ id: 's1', name: 'Sheet import', sections: [section('s1-0', 0, 1, 'Verse')] }],
      activeChordLayerName: 'My chords',
    })
    const map = parseSongMap(json)
    expect(map.formatVersion).toBe(SONGMAP_FORMAT_VERSION)
    expect(map.activeDraftName).toBe('My chords')
    expect(map.drafts).toHaveLength(1)
    expect(map.drafts![0].name).toBe('Sheet import')
    expect(map.drafts![0].sections.map((s) => s.label)).toEqual(['Verse'])
    // The active draft's content is still exactly where every consumer reads it.
    expect(map.sections.map((s) => s.label)).toEqual(['Active'])
    expect(map.harmony.map((h) => h.chord.displayRaw)).toEqual(['C'])
  })

  it('migrating is idempotent — re-parsing a migrated map changes nothing', () => {
    const json = v5Json({
      sections: [section('active-sec', 0, 3, 'Active')],
      harmony: [looseChord('active-ch', 'C')],
      chordLayers: [{ id: 'c1', name: 'Sheet import', harmony: [looseChord('c1-0', 'G')] }],
      activeChordLayerName: 'My chords',
    })
    const once = parseSongMap(json)
    const twice = parseSongMap(JSON.stringify(once))
    expect(JSON.stringify(twice)).toBe(JSON.stringify(once))
  })

  it('rejects a file from a newer build with an upgrade message', () => {
    const base = createEmptySongMap({ now: () => '2020-01-01T00:00:00.000Z' })
    expect(() => parseSongMap(JSON.stringify({
      ...base,
      formatVersion: SONGMAP_FORMAT_VERSION + 1,
    }))).toThrow(
      /Update BarBro/,
    )
  })
})
