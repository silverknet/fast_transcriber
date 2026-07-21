/**
 * Multi-user sharing for song drafts (v6).
 *
 * These simulate two people on the same cloud project rather than testing one
 * function in isolation, because the failure modes only appear at the seams:
 * a v5 row migrating differently on two devices, or a per-id merge blending
 * two DIFFERENT drafts into an arrangement neither person made.
 */
import { describe, expect, it } from 'vitest'
import { collabContentFingerprint, toCollabSongMap } from './collab'
import { applyConflictDecisions, mergeForConflict } from './collabMerge'
import { addDraftAndActivate, ensureActiveDraftIdentity, switchToDraft } from './drafts'
import { createEmptySongMap } from './factory'
import { parseSongMap } from './parse'
import { validateSongMap } from './validate'
import type { HarmonyEvent, Section, SongMap } from './types'

let idCounter = 0
const newId = (): string => `id${++idCounter}`

function section(id: string, start: number, label: string): Section {
  return { id, kind: 'verse', label, barRange: { startBarIndex: start, endBarIndex: start + 3 } }
}

function chord(id: string, displayRaw: string): HarmonyEvent {
  return {
    id,
    barId: 'bar0',
    startSec: 0,
    endSec: 1,
    chord: { root: 'C', quality: 'maj', displayRaw },
  }
}

/** A song both collaborators start from, with two drafts. */
function sharedSong(): SongMap {
  idCounter = 0
  const base: SongMap = {
    ...createEmptySongMap({ now: () => '2020-01-01T00:00:00.000Z' }),
    sections: [section('sec-a1', 0, 'Verse A'), section('sec-a2', 4, 'Chorus A')],
    harmony: [chord('ch-a1', 'C'), chord('ch-a2', 'F')],
  }
  const withId = ensureActiveDraftIdentity(base, newId)
  // Draft "Sheet import" becomes active; "My draft" is stored.
  return addDraftAndActivate(
    withId,
    {
      sections: [section('sec-b1', 0, 'Intro B')],
      harmony: [chord('ch-b1', 'G'), chord('ch-b2', 'Am')],
      lyrics: undefined,
    },
    'Sheet import',
    newId,
  )
}

describe('two devices migrating the same legacy row', () => {
  /** A v5 cloud row as it would sit in `cloud_songs.song_map`. */
  const legacyRow = {
    ...createEmptySongMap({ now: () => '2020-01-01T00:00:00.000Z' }),
    formatVersion: 5,
    activeDraftId: undefined,
    activeDraftName: undefined,
    sections: [section('s-active', 0, 'Active')],
    harmony: [chord('h-active', 'C')],
    chordLayers: [{ id: 'cl1', name: 'Sheet import', harmony: [chord('cl1-0', 'G')] }],
    sectionLayers: [{ id: 'sl1', name: 'My sections', sections: [section('sl1-0', 0, 'Intro')] }],
    activeChordLayerName: 'My chords',
  }

  it('produces byte-identical results on both devices', () => {
    const deviceA = parseSongMap(JSON.stringify(legacyRow))
    const deviceB = parseSongMap(JSON.stringify(legacyRow))
    expect(JSON.stringify(deviceA)).toBe(JSON.stringify(deviceB))
  })

  it('agrees on the content fingerprint, so neither device sees a phantom conflict', () => {
    // A disagreement here is the push-loop failure mode: each device thinks the
    // other's copy is dirty and re-pushes forever.
    const deviceA = parseSongMap(JSON.stringify(legacyRow))
    const deviceB = parseSongMap(JSON.stringify(legacyRow))
    expect(collabContentFingerprint(deviceA)).toBe(collabContentFingerprint(deviceB))
  })

  it('a device that already migrated matches one migrating fresh', () => {
    const migrated = parseSongMap(JSON.stringify(legacyRow))
    const roundTripped = parseSongMap(JSON.stringify(toCollabSongMap(migrated)))
    expect(collabContentFingerprint(roundTripped)).toBe(collabContentFingerprint(migrated))
  })
})

describe('drafts survive the cloud round trip', () => {
  it('stored drafts and the selection are pushed, not stripped', () => {
    const local = sharedSong()
    const pushed = toCollabSongMap(local)
    expect(pushed.drafts?.map((d) => d.name)).toEqual(local.drafts?.map((d) => d.name))
    expect(pushed.activeDraftId).toBe(local.activeDraftId)
    expect(pushed.activeDraftName).toBe('Sheet import')
  })

  it('chord colour survives the round trip', () => {
    const local: SongMap = {
      ...sharedSong(),
      harmony: [
        {
          ...chord('ch-colour', 'Bm7b5'),
          chord: {
            root: 'B',
            quality: 'min7',
            alterations: ['b5'],
            displayRaw: 'Bm7b5',
          },
        },
      ],
    }
    const back = parseSongMap(JSON.stringify(toCollabSongMap(local)))
    expect(back.harmony[0].chord.alterations).toEqual(['b5'])
  })
})

describe('two people on DIFFERENT drafts', () => {
  /** Alice stays on "Sheet import"; Bob switches to "My draft" and pushes. */
  function divergent(): { alice: SongMap; bob: SongMap } {
    const base = sharedSong()
    const storedId = base.drafts![0].id
    const switched = switchToDraft(base, storedId, newId)
    if (!switched.ok) throw new Error('fixture: switch failed')
    return { alice: base, bob: switched.map }
  }

  it('does not blend the two drafts into an arrangement nobody made', () => {
    const { alice, bob } = divergent()
    const { merged } = mergeForConflict(alice, bob)
    // Bob's draft (cloud) wins the root by default...
    expect(merged.activeDraftId).toBe(bob.activeDraftId)
    expect(merged.sections.map((s) => s.label)).toEqual(bob.sections.map((s) => s.label))
    // ...and critically, Alice's sections are NOT unioned in.
    for (const s of alice.sections) {
      expect(merged.sections.some((x) => x.id === s.id)).toBe(false)
    }
    expect(merged.harmony.map((h) => h.id)).toEqual(bob.harmony.map((h) => h.id))
  })

  it('preserves the losing side as a stored draft', () => {
    const { alice, bob } = divergent()
    const { merged } = mergeForConflict(alice, bob)
    const kept = merged.drafts?.find((d) => d.id === alice.activeDraftId)
    expect(kept, "Alice's draft must survive the merge").toBeDefined()
    expect(kept!.sections.map((s) => s.label)).toEqual(alice.sections.map((s) => s.label))
    expect(kept!.harmony.map((h) => h.id)).toEqual(alice.harmony.map((h) => h.id))
  })

  it('preserves a draft the other side has never seen', () => {
    // Tighter than the case above: there, Bob's switch had already stored
    // Alice's draft, so preserving it came for free. Here Alice runs a sheet
    // import that mints a draft Bob's copy knows nothing about — if the merge
    // doesn't store it explicitly, that import is gone.
    const base = sharedSong()
    const alice = addDraftAndActivate(
      base,
      {
        sections: [section('sec-imp', 0, 'Imported')],
        harmony: [chord('ch-imp', 'Bb')],
        lyrics: undefined,
      },
      'Alice import',
      newId,
    )
    const switched = switchToDraft(base, base.drafts![0].id, newId)
    if (!switched.ok) throw new Error('fixture: switch failed')
    const bob = switched.map
    expect(bob.drafts?.some((d) => d.id === alice.activeDraftId)).toBe(false)

    const { merged } = mergeForConflict(alice, bob)
    const kept = merged.drafts?.find((d) => d.id === alice.activeDraftId)
    expect(kept, "Alice's import must survive").toBeDefined()
    expect(kept!.name).toBe('Alice import')
    expect(kept!.harmony.map((h) => h.id)).toEqual(['ch-imp'])
    expect(kept!.sections.map((s) => s.label)).toEqual(['Imported'])
  })

  it("a stale copy on the other device does not shadow the live draft", () => {
    // Bob switched away from "Sheet import", so his copy is a snapshot from
    // that moment. Alice stayed on it and kept editing. The merge must store
    // ALICE's version — the stale snapshot must not win just by existing.
    const base = sharedSong()
    const aliceEdited: SongMap = {
      ...base,
      harmony: [...base.harmony, chord('ch-after-switch', 'Cmaj7')],
    }
    const switched = switchToDraft(base, base.drafts![0].id, newId)
    if (!switched.ok) throw new Error('fixture: switch failed')
    const bob = switched.map
    // Bob really does hold a stale copy under the same id.
    const stale = bob.drafts?.find((d) => d.id === aliceEdited.activeDraftId)
    expect(stale).toBeDefined()
    expect(stale!.harmony.map((h) => h.id)).not.toContain('ch-after-switch')

    const { merged } = mergeForConflict(aliceEdited, bob)
    const kept = merged.drafts?.find((d) => d.id === aliceEdited.activeDraftId)
    expect(kept).toBeDefined()
    expect(kept!.harmony.map((h) => h.id)).toContain('ch-after-switch')
  })

  it('raises exactly one draft-level conflict, not a pile of chord rows', () => {
    const { alice, bob } = divergent()
    const { conflicts } = mergeForConflict(alice, bob)
    const paths = conflicts.map((c) => c.path)
    expect(paths).toContain('activeDraft')
    expect(paths.filter((p) => p.startsWith('harmony'))).toHaveLength(0)
    expect(paths.filter((p) => p.startsWith('sections'))).toHaveLength(0)
  })

  it('does not offer lyrics as a separately resolvable row', () => {
    // Lyrics belong to the draft. A separate row could be answered the
    // opposite way, pairing one draft's lyrics with another draft's chords.
    const base = sharedSong()
    const alice: SongMap = {
      ...base,
      lyrics: { words: [], sourceText: 'alice words' },
    }
    const switched = switchToDraft(base, base.drafts![0].id, newId)
    if (!switched.ok) throw new Error('fixture: switch failed')
    const bob: SongMap = { ...switched.map, lyrics: { words: [], sourceText: 'bob words' } }

    const { conflicts } = mergeForConflict(alice, bob)
    expect(conflicts.map((c) => c.path)).toContain('activeDraft')
    expect(conflicts.map((c) => c.path)).not.toContain('lyrics')
  })

  it('choosing "keep mine" swaps the drafts and still loses nothing', () => {
    const { alice, bob } = divergent()
    const report = mergeForConflict(alice, bob)
    const resolved = applyConflictDecisions(report, new Map([['activeDraft', 'mine']]))

    expect(resolved.activeDraftId).toBe(alice.activeDraftId)
    expect(resolved.sections.map((s) => s.label)).toEqual(alice.sections.map((s) => s.label))
    // Bob's draft is now the stored one — the swap is symmetric.
    const bobsKept = resolved.drafts?.find((d) => d.id === bob.activeDraftId)
    expect(bobsKept, "Bob's draft must survive too").toBeDefined()
    expect(bobsKept!.harmony.map((h) => h.id)).toEqual(bob.harmony.map((h) => h.id))
  })

  it('the merge result is a valid SongMap either way', () => {
    const { alice, bob } = divergent()
    const report = mergeForConflict(alice, bob)
    for (const decision of [undefined, new Map([['activeDraft', 'mine' as const]])]) {
      const out = decision ? applyConflictDecisions(report, decision) : report.merged
      const v = validateSongMap(out)
      expect(v.ok, v.ok === false ? v.errors.join('; ') : '').toBe(true)
      // The active draft must never ALSO be stored.
      expect(out.drafts?.some((d) => d.id === out.activeDraftId)).toBeFalsy()
    }
  })

  it('is deterministic — both devices merging the same pair agree byte for byte', () => {
    const a = divergent()
    const b = divergent()
    expect(JSON.stringify(mergeForConflict(a.alice, a.bob).merged)).toBe(
      JSON.stringify(mergeForConflict(b.alice, b.bob).merged),
    )
  })
})

describe('two people on the SAME draft', () => {
  it('still merges chords per-id so concurrent edits both land', () => {
    const base = sharedSong()
    const alice: SongMap = { ...base, harmony: [...base.harmony, chord('ch-alice', 'Dm')] }
    const bob: SongMap = { ...base, harmony: [...base.harmony, chord('ch-bob', 'Em')] }
    const { merged } = mergeForConflict(alice, bob)
    const ids = merged.harmony.map((h) => h.id)
    expect(ids).toContain('ch-alice')
    expect(ids).toContain('ch-bob')
  })

  it('a draft each collaborator created independently both survive', () => {
    // Whole-field LWW on `drafts` used to drop one of these.
    const base = sharedSong()
    const alice = addDraftAndActivate(
      base,
      { sections: [], harmony: [chord('ch-x', 'X')], lyrics: undefined },
      'Alice idea',
      newId,
    )
    const bob = addDraftAndActivate(
      base,
      { sections: [], harmony: [chord('ch-y', 'Y')], lyrics: undefined },
      'Bob idea',
      newId,
    )
    const { merged } = mergeForConflict(alice, bob)
    const names = [merged.activeDraftName, ...(merged.drafts ?? []).map((d) => d.name)]
    expect(names).toContain('Alice idea')
    expect(names).toContain('Bob idea')
    expect(names).toContain('Sheet import')
  })
})
