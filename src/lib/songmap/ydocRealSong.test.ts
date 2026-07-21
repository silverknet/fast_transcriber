/**
 * Round-trip proof against songs built by the REAL edit helpers.
 *
 * The repo carries no `.smap` fixtures, so "every song in a real project"
 * (Phase 2's done-when) has no corpus to run against. The closest honest
 * substitute is to drive the same functions the editor drives —
 * `mergeAnalysisIntoSongMap`, `upsertHarmonyAtBeat`, `setSectionForBarRange`,
 * `generateCueTrackFromSections`, the draft operations, transposition — and
 * round-trip whatever they produce.
 *
 * This also answers the question the synthetic fixtures cannot: is the derived
 * canonical order actually the order the app already stores things in? If it
 * is, then making the document authoritative in Phase 3/4 will not silently
 * re-order anyone's song.
 */
import { describe, expect, it } from 'vitest'
import { collabContentFingerprint, toCollabSongMap } from './collab'
import { createDefaultCueTrack, generateCueTrackFromSections } from './cueTracks'
import { addDraftAndActivate, switchToDraft } from './drafts'
import { createEmptySongMap } from './factory'
import { upsertHarmonyAtBeat } from './harmonyEdit'
import { mergeAnalysisIntoSongMap } from './merge'
import { setSectionForBarRange } from './sectionEdit'
import { splitBarAtMidpoint } from './timelineEdit'
import type { Bar, Beat, ChordSymbol, SongMap } from './types'
import { canonicalSongMapOrder, roundTripThroughYDoc, songMapSeedUpdate } from './ydoc'

/** Deterministic id factory so the built song is reproducible run to run. */
function seqIds(prefix: string): () => string {
  let n = 0
  return () => `${prefix}-${n++}`
}

function analysisFragment(barCount: number, beatsPerBar = 4, beatDur = 0.5) {
  const bars: Bar[] = []
  const beats: Beat[] = []
  for (let b = 0; b < barCount; b++) {
    const barId = `bar-${b}`
    const start = b * beatsPerBar * beatDur
    const beatIds: string[] = []
    for (let i = 0; i < beatsPerBar; i++) {
      const id = `beat-${b}-${i}`
      beatIds.push(id)
      beats.push({ id, barId, indexInBar: i, timeSec: start + i * beatDur, source: 'detected' })
    }
    bars.push({
      id: barId,
      index: b,
      startSec: start,
      endSec: start + beatsPerBar * beatDur,
      meter: { numerator: beatsPerBar, denominator: 4 },
      beatCount: beatsPerBar,
      beatIds,
    })
  }
  return { bars, beats, confidence: 0.9 }
}

const CHORDS: ChordSymbol[] = [
  { root: 'E', accidental: 'flat', quality: 'maj7', displayRaw: 'Ebmaj7' },
  { root: 'B', quality: 'min7', alterations: ['b5'], displayRaw: 'Bm7b5' },
  { root: 'A', quality: 'sus4', extensions: ['9'], displayRaw: 'Asus4(9)' },
  { root: 'G', quality: '7', bass: 'D', displayRaw: 'G7/D' },
]

/**
 * A song assembled the way the editor assembles one: analyze, edit the grid,
 * enter chords, mark sections, generate cues, then branch a second draft.
 */
function buildSongViaEditHelpers(): SongMap {
  const ids = seqIds('id')
  let sm = createEmptySongMap({
    idFactory: ids,
    now: () => '2026-01-01T00:00:00.000Z',
  })

  sm = mergeAnalysisIntoSongMap(sm, analysisFragment(8))

  // A grid edit, so the timeline is not just the analyzer's output.
  const split = splitBarAtMidpoint(sm, sm.timeline.bars[2]!.id, ids)
  if (split.ok) sm = split.map

  // Chords on every downbeat.
  const downbeats = sm.timeline.beats.filter((b) => b.indexInBar === 0)
  downbeats.forEach((beat, i) => {
    const res = upsertHarmonyAtBeat(sm, beat.id, CHORDS[i % CHORDS.length]!, ids)
    if (res.ok) sm = res.map
  })

  // Sections across the song.
  for (const [start, end, kind] of [
    [0, 1, 'intro'],
    [2, 4, 'verse'],
    [5, 8, 'chorus'],
  ] as const) {
    const res = setSectionForBarRange(sm, start, end, kind, ids)
    if (res.ok) sm = res.map
  }

  // Cue track generated from those sections.
  sm = {
    ...sm,
    cueTracks: [generateCueTrackFromSections(sm, createDefaultCueTrack(), { idFactory: ids })],
    countInBeats: 4,
    startBeatId: sm.timeline.beats[0]?.id,
    transpose: { baseSemitones: -2 },
  }

  // Branch a second draft, then switch back — the shape a user who tried an
  // alternative arrangement ends up with.
  const originalDraftId = sm.activeDraftId!
  sm = addDraftAndActivate(
    sm,
    { sections: sm.sections.slice(0, 1), harmony: sm.harmony.slice(0, 2) },
    'Alternative take',
    ids,
  )
  const switched = switchToDraft(sm, originalDraftId, ids)
  if (switched.ok) sm = switched.map

  return sm
}

describe('Y.Doc round trip on a song built by the real edit helpers', () => {
  const sm = buildSongViaEditHelpers()

  it('builds a non-trivial song', () => {
    expect(sm.timeline.bars.length).toBeGreaterThan(8)
    expect(sm.harmony.length).toBeGreaterThan(4)
    expect(sm.sections.length).toBeGreaterThan(2)
    expect(sm.cueTracks[0]!.events.length).toBeGreaterThan(0)
    expect(sm.drafts?.length).toBe(1)
  })

  it('is ALREADY in the order the document derives', () => {
    // The load-bearing claim for Phase 3/4: the derive step's sort is a no-op
    // on songs the app produces, so making the document authoritative will not
    // re-order anyone's stored song (which would otherwise churn
    // `collabContentFingerprint` and trigger a one-off push for every song).
    expect(canonicalSongMapOrder(sm)).toEqual(sm)
  })

  it('round-trips field for field', () => {
    expect(roundTripThroughYDoc(sm)).toEqual(toCollabSongMap(sm))
  })

  it('round-trips the collaborative fingerprint exactly', () => {
    expect(collabContentFingerprint(roundTripThroughYDoc(sm))).toBe(collabContentFingerprint(sm))
  })

  it('seeds deterministically, including from a JSON-round-tripped copy', () => {
    // A JSON round trip is what actually happens between two devices: one
    // writes `.smap` / a cloud row, the other parses it back. Object identity
    // and key insertion order are both lost, and the seed must not notice.
    //
    // (The builder itself is NOT deterministic — `switchToDraft` and
    // `mergeAnalysisIntoSongMap` stamp `new Date()` — so this seeds one song
    // rather than comparing two independent builds.)
    const reparsed = JSON.parse(JSON.stringify(sm)) as SongMap
    expect(songMapSeedUpdate(sm)).toEqual(songMapSeedUpdate(sm))
    expect(songMapSeedUpdate(reparsed)).toEqual(songMapSeedUpdate(sm))
  })
})
