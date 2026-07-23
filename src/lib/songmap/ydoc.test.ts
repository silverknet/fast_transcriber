/**
 * Phase 2 proof: the shadow `Y.Doc` says exactly what the parsed `SongMap`
 * says, and seeding it is deterministic.
 *
 * Two things are being held down here:
 *
 *  1. **Round-trip equality.** `yDocToSongMap(songMapToYDoc(sm))` equals `sm`
 *     on the COLLABORATIVE subset (`collabContentFingerprint`). It cannot equal
 *     `sm` outright, because local-only fields deliberately are not in the
 *     document — that is the point of the structural boundary.
 *  2. **Seed determinism (§8).** Two independent seeds of the same song must be
 *     byte-identical, or two devices seeding the same `.smap` merge into a song
 *     with every bar, chord and section duplicated.
 */
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import * as Y from 'yjs'
import { collabContentFingerprint, toCollabSongMap } from './collab'
import type { SongMap } from './types'
import {
  SEED_CLIENT_ID,
  canonicalSongMapOrder,
  hydrateSongDoc,
  roundTripThroughYDoc,
  songMapSeedUpdate,
  songMapToYDoc,
  yDocToSongMap,
} from './ydoc'
import { minimalSongMap, richSongMap } from './ydocFixtures'

function digest(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex')
}

describe('songMapToYDoc / yDocToSongMap round trip', () => {
  it('preserves the collaborative content of a rich v6 song', () => {
    // The document stores collections id-keyed, so ARRAY ORDER is not stored —
    // it is derived (§5). Round-trip equality is therefore equality up to
    // `canonicalSongMapOrder`, which is a semantic no-op: every consumer that
    // cares about order already sorts at read time.
    const sm = canonicalSongMapOrder(richSongMap())
    expect(collabContentFingerprint(roundTripThroughYDoc(sm))).toBe(collabContentFingerprint(sm))
  })

  it('reproduces the collaborative SongMap field for field', () => {
    const sm = richSongMap()
    // Exact structural equality against the canonically-ordered collaborative
    // projection — a much tighter claim than the fingerprint, which tolerates
    // 6-decimal float rounding and key reordering.
    expect(roundTripThroughYDoc(sm)).toEqual(canonicalSongMapOrder(toCollabSongMap(sm)))
  })

  it('canonical ordering is idempotent and fingerprint-stable', () => {
    const once = canonicalSongMapOrder(richSongMap())
    expect(canonicalSongMapOrder(once)).toEqual(once)
    expect(collabContentFingerprint(canonicalSongMapOrder(once))).toBe(
      collabContentFingerprint(once),
    )
  })

  it('round-trips a minimal song without inventing fields', () => {
    const sm = canonicalSongMapOrder(minimalSongMap())
    expect(roundTripThroughYDoc(sm)).toEqual(canonicalSongMapOrder(toCollabSongMap(sm)))
    expect(collabContentFingerprint(roundTripThroughYDoc(sm))).toBe(collabContentFingerprint(sm))
  })

  it('keeps every local-only field OUT of the document', () => {
    const sm = richSongMap()
    const derived = roundTripThroughYDoc(sm)

    expect(derived.projectFolder).toBeUndefined()
    expect(derived.stemRefs).toBeUndefined()
    expect(derived.sectionBorderHints).toBeUndefined()
    expect(derived.chordHints).toBeUndefined()
    expect(derived.mixState).toBeUndefined()
    expect(derived.audio?.originalPath).toBeUndefined()
    expect(derived.cueTracks[0]?.renderExport?.relativePath).toBeUndefined()
    expect(derived.clickExport?.relativePath).toBeUndefined()
    expect(derived.drumMidi?.renderExport?.relativePath).toBeUndefined()

    // Nor anywhere in the encoded bytes — a leak would show up as the raw
    // string even if the derive step happened to hide it.
    const encoded = new TextDecoder('utf-8', { fatal: false }).decode(songMapSeedUpdate(sm))
    for (const secret of [
      'ValerieProject', // projectFolder
      'local-only/drums-path.wav', // stemRefs
      'cue/tracks/main/cue-track.wav', // cueTracks[].renderExport.relativePath
      'cue/click.wav', // clickExport.relativePath
      'render/drums.wav', // drumMidi.renderExport.relativePath
      'audio/valerie.wav', // audio.originalPath
    ]) {
      expect(encoded).not.toContain(secret)
    }
  })

  it('keeps the render-validity fields that DO sync', () => {
    const derived = roundTripThroughYDoc(richSongMap())
    expect(derived.cueTracks[0]?.renderExport).toMatchObject({
      fingerprint: 'cue-fp-1',
      durationSec: 214,
      sampleRate: 48000,
      preludeOffsetSec: 2.5,
    })
  })

  it('distinguishes an absent optional field from a present one', () => {
    const sm = minimalSongMap()
    const derived = roundTripThroughYDoc(sm)
    expect('audio' in derived).toBe(false)
    expect('drafts' in derived).toBe(false)
    expect('countInBeats' in derived).toBe(false)
    expect('startBeatId' in derived).toBe(false)
    expect('transpose' in derived).toBe(false)
    expect('lyrics' in derived).toBe(false)
  })

  it('normalizes an empty drafts array to no drafts field', () => {
    // An id-keyed map cannot represent "present but empty". The app already
    // makes these one state — `deleteDraft` collapses the last draft to
    // `undefined` — so the document follows suit rather than inventing a
    // presence marker.
    const withEmpty: SongMap = { ...minimalSongMap(), drafts: [] }
    expect(roundTripThroughYDoc(withEmpty).drafts).toBeUndefined()
    expect(collabContentFingerprint(roundTripThroughYDoc(withEmpty))).toBe(
      collabContentFingerprint(canonicalSongMapOrder(withEmpty)),
    )
  })

  it('carries through a field this build has never heard of', () => {
    // Forward compatibility: a v7 client adds a top-level field, a v6 client
    // reads and re-seeds the document. The field must survive.
    const sm = { ...richSongMap(), someFutureField: { a: 1, b: ['x'] } } as SongMap
    const derived = roundTripThroughYDoc(sm) as SongMap & { someFutureField?: unknown }
    expect(derived.someFutureField).toEqual({ a: 1, b: ['x'] })
  })

  it('sorts collections into canonical order regardless of input order', () => {
    const sm = richSongMap()
    const shuffled: SongMap = {
      ...sm,
      timeline: {
        ...sm.timeline,
        bars: [...sm.timeline.bars].reverse(),
        beats: [...sm.timeline.beats].reverse(),
      },
      sections: [...sm.sections].reverse(),
      harmony: [...sm.harmony].reverse(),
    }
    const derived = roundTripThroughYDoc(shuffled)

    expect(derived.timeline.bars.map((b) => b.index)).toEqual([0, 1])
    expect(derived.timeline.beats.map((b) => b.timeSec)).toEqual([0.5, 1, 1.5, 2, 2.5, 3, 3.5])
    expect(derived.sections.map((s) => s.id)).toEqual(['sec-intro', 'sec-verse'])
    expect(derived.harmony.map((h) => h.id)).toEqual(['h-1', 'h-2'])

    // The document stores no array order, so a shuffled input and a canonical
    // one are literally the same document.
    expect(digest(songMapSeedUpdate(shuffled))).toBe(digest(songMapSeedUpdate(sm)))
  })

  it('does not let a reader mutate the document', () => {
    // `Y.Map.toJSON()` hands back any plain object it holds BY REFERENCE, so a
    // naive derive leaks writable aliases of `bar.meter`, `chord`,
    // `section.barRange`, `metadata.keyDetail` … and a reader could then edit
    // the document with no transaction and no observer firing. Rule 4 (readers
    // get a plain SongMap) has to mean a DETACHED one.
    const doc = songMapToYDoc(richSongMap())
    const first = yDocToSongMap(doc)

    first.timeline.bars[0]!.startSec = 999
    first.metadata.title = 'clobbered'
    first.timeline.bars[0]!.meter.numerator = 99
    first.timeline.bars[0]!.beatIds.push('injected')
    first.metadata.keyDetail!.root = 'A'
    first.harmony[0]!.chord.displayRaw = 'clobbered'
    first.harmony[0]!.chord.alterations!.push('b9')
    first.sections[0]!.barRange.startBarIndex = 77
    first.cueTracks[0]!.events[0]!.anchor.kind = 'bar'
    first.drafts!.find((d) => d.id === 'draft-sheet')!.harmony[0]!.chord.root = 'F'

    const second = yDocToSongMap(doc)
    expect(second.timeline.bars[0]!.startSec).toBe(0.5)
    expect(second.metadata.title).toBe('Valerie')
    expect(second.timeline.bars[0]!.meter.numerator).toBe(4)
    expect(second.timeline.bars[0]!.beatIds).toHaveLength(4)
    expect(second.metadata.keyDetail!.root).toBe('E')
    expect(second.harmony[0]!.chord.displayRaw).toBe('Bm7b5')
    expect(second.harmony[0]!.chord.alterations).toEqual(['b5'])
    expect(second.sections[0]!.barRange.startBarIndex).toBe(0)
    // Events sort by id, so events[0] is `ev-beat`.
    expect(second.cueTracks[0]!.events[0]!.anchor.kind).toBe('beat')
    expect(second.drafts!.find((d) => d.id === 'draft-sheet')!.harmony[0]!.chord.root).toBe('A')
  })

  it('is stable under repeated seed → derive → seed cycles', () => {
    const once = roundTripThroughYDoc(richSongMap())
    const twice = roundTripThroughYDoc(once)
    expect(twice).toEqual(once)
    expect(digest(songMapSeedUpdate(once))).toBe(digest(songMapSeedUpdate(twice)))
  })
})

describe('seed determinism (architecture doc §8)', () => {
  it('seeds under the pinned clientID', () => {
    expect(songMapToYDoc(richSongMap()).clientID).toBe(SEED_CLIENT_ID)
  })

  it('produces byte-identical updates for two independent seeds', () => {
    // Each `new Y.Doc()` re-randomises `clientID`, so this fails immediately if
    // the pin is dropped.
    const sm = richSongMap()
    expect(songMapSeedUpdate(sm)).toEqual(songMapSeedUpdate(sm))
    expect(digest(songMapSeedUpdate(sm))).toBe(digest(songMapSeedUpdate(richSongMap())))
  })

  it('is blind to object key order in the source map', () => {
    // A map parsed from a `.smap` file carries the file's key order; the same
    // map pulled from Postgres carries JSONB's internal order. They must seed
    // identically or the two devices diverge for a reason no user could see.
    const deepReverse = (v: unknown): unknown => {
      if (Array.isArray(v)) return v.map(deepReverse)
      if (v && typeof v === 'object') {
        const out: Record<string, unknown> = {}
        for (const k of Object.keys(v as Record<string, unknown>).reverse()) {
          out[k] = deepReverse((v as Record<string, unknown>)[k])
        }
        return out
      }
      return v
    }
    const sm = richSongMap()
    const reversed = deepReverse(JSON.parse(JSON.stringify(sm))) as SongMap
    expect(digest(songMapSeedUpdate(reversed))).toBe(digest(songMapSeedUpdate(sm)))
  })

  it('two devices seeding the same song merge to ONE song, not a duplicated one', () => {
    // This is the failure §8 is about. Both devices seed independently, then
    // exchange updates.
    const sm = canonicalSongMapOrder(richSongMap())
    const deviceA = hydrateSongDoc(songMapSeedUpdate(sm))
    const deviceB = hydrateSongDoc(songMapSeedUpdate(sm))
    expect(deviceA.clientID).not.toBe(deviceB.clientID)

    Y.applyUpdate(deviceA, Y.encodeStateAsUpdate(deviceB))
    Y.applyUpdate(deviceB, Y.encodeStateAsUpdate(deviceA))

    const merged = yDocToSongMap(deviceA)
    expect(merged.timeline.bars).toHaveLength(sm.timeline.bars.length)
    expect(merged.timeline.beats).toHaveLength(sm.timeline.beats.length)
    expect(merged.harmony).toHaveLength(sm.harmony.length)
    expect(merged.sections).toHaveLength(sm.sections.length)
    expect(merged.drafts).toHaveLength(sm.drafts!.length)
    expect(merged.cueTracks[0]!.events).toHaveLength(sm.cueTracks[0]!.events.length)
    expect(collabContentFingerprint(merged)).toBe(collabContentFingerprint(sm))
    expect(collabContentFingerprint(yDocToSongMap(deviceB))).toBe(collabContentFingerprint(sm))
  })

  it('NEGATIVE CONTROL: an unpinned seed produces different bytes', () => {
    // The same content and the same op order, seeded under a different
    // clientID, encodes differently. This is the whole hazard, and it keeps the
    // guarantee above from silently becoming vacuous.
    const sm = richSongMap()
    expect(digest(Y.encodeStateAsUpdate(songMapToYDoc(sm, { clientID: 12345 })))).not.toBe(
      digest(songMapSeedUpdate(sm)),
    )
  })

  it('NEGATIVE CONTROL: unpinned seeds silently DROP a local edit on merge', () => {
    // What §8 costs in practice. §8 predicts duplicated bars; because §5 keys
    // collections by id rather than by position, the real failure mode is worse
    // and quieter — the id-keyed CONTAINER (`timeline.bars`) is itself a value
    // in `timeline`, so two independent seeds are two concurrent
    // `timeline.set('bars', …)` writes. One container wins wholesale and every
    // edit made inside the loser is discarded.
    const sm = richSongMap()

    const seedIndependently = (clientID: number) => {
      const device = new Y.Doc()
      Y.applyUpdate(device, Y.encodeStateAsUpdate(songMapToYDoc(sm, { clientID })))
      return device
    }

    // Device A seeds its own document and the user edits a bar.
    const deviceA = seedIndependently(111)
    const barsA = deviceA.getMap<Y.Map<unknown>>('timeline').get('bars') as Y.Map<Y.Map<unknown>>
    deviceA.transact(() => {
      barsA.get('bar-1')!.set('startSec', 42)
    })
    expect(yDocToSongMap(deviceA).timeline.bars[0]!.startSec).toBe(42)

    // Device B seeded the same `.smap` independently, and they sync.
    const deviceB = seedIndependently(222)
    Y.applyUpdate(deviceA, Y.encodeStateAsUpdate(deviceB))

    // The edit is gone: B's `bars` container replaced A's.
    expect(yDocToSongMap(deviceA).timeline.bars[0]!.startSec).toBe(0.5)

    // With the pin, both devices seeded the SAME container, so the edit stands.
    const pinnedA = hydrateSongDoc(songMapSeedUpdate(sm))
    const pinnedBars = pinnedA.getMap<Y.Map<unknown>>('timeline').get('bars') as Y.Map<Y.Map<unknown>>
    pinnedA.transact(() => {
      pinnedBars.get('bar-1')!.set('startSec', 42)
    })
    Y.applyUpdate(pinnedA, Y.encodeStateAsUpdate(hydrateSongDoc(songMapSeedUpdate(sm))))
    expect(yDocToSongMap(pinnedA).timeline.bars[0]!.startSec).toBe(42)
  })

  it('is identical in a separate process', () => {
    const local = {
      rich: digest(songMapSeedUpdate(richSongMap())),
      minimal: digest(songMapSeedUpdate(minimalSongMap())),
    }
    const stdout = execFileSync(
      'npx',
      ['--no-install', 'vite-node', 'src/lib/songmap/ydocSeedProbe.ts'],
      { cwd: process.cwd(), encoding: 'utf8', timeout: 120_000 },
    )
    expect(JSON.parse(stdout.trim())).toEqual(local)
  }, 120_000)
})
