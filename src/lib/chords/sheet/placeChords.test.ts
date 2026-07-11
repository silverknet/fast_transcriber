import { describe, expect, it } from 'vitest'
import { SONGMAP_FORMAT_VERSION } from '$lib/songmap/version'
import { sortBeatsByTime } from '$lib/songmap/normalize'
import { beatAtTime, snapChordTimeToBeat, CHORD_SNAP_FORWARD_RATIO } from '$lib/songmap/beatAtTime'
import type { Bar, Beat, LyricWord, SongMap } from '$lib/songmap/types'
import { parseChordSheet } from './parseChordSheet'
import { placeChords } from './placeChords'
import { applyChordPlacements } from './applyPlacement'

// ── Fixture: 8 bars of 4/4 at 1 bar/sec (beat = 0.25 s), like autoFill.test ──

function bar(index: number, beatsPerBar = 4): Bar {
  return {
    id: `bar${index}`,
    index,
    startSec: index,
    endSec: index + 1,
    meter: { numerator: beatsPerBar, denominator: 4 },
    beatCount: beatsPerBar,
    beatIds: Array.from({ length: beatsPerBar }, (_, i) => `b${index}_${i}`),
  }
}

function beat(barIndex: number, indexInBar: number, beatsPerBar = 4): Beat {
  return {
    id: `b${barIndex}_${indexInBar}`,
    barId: `bar${barIndex}`,
    indexInBar,
    timeSec: barIndex + indexInBar / beatsPerBar,
  }
}

function buildMap(opts: { barCount?: number; lyrics?: { sourceText: string; words: LyricWord[] } }): SongMap {
  const barCount = opts.barCount ?? 8
  const bars: Bar[] = []
  const beats: Beat[] = []
  for (let i = 0; i < barCount; i++) {
    bars.push(bar(i))
    for (let j = 0; j < 4; j++) beats.push(beat(i, j))
  }
  return {
    formatVersion: SONGMAP_FORMAT_VERSION,
    metadata: { title: 't' },
    timeline: { bars, beats },
    harmony: [],
    sections: [],
    cueTracks: [],
    lyrics: opts.lyrics,
  } as unknown as SongMap
}

function words(...specs: Array<[string, number, number, boolean?]>): LyricWord[] {
  // [text, startSec, line, aligned]
  return specs.map(([text, startSec, line, aligned]) => ({
    text,
    startSec,
    endSec: startSec + 0.2,
    line,
    ...(aligned === false ? {} : { aligned: true }),
  }))
}

const newId = (() => {
  let n = 0
  return () => `id${n++}`
})()

// ── beatAtTime / snapChordTimeToBeat ────────────────────────────────────────

describe('beatAtTime + snapChordTimeToBeat', () => {
  const map = buildMap({})
  const sorted = sortBeatsByTime(map.timeline.beats)
  const barsById = new Map(map.timeline.bars.map((b) => [b.id, b]))

  it('resolves the owning beat, clamping before the first', () => {
    expect(beatAtTime(sorted, -1)?.id).toBe('b0_0')
    expect(beatAtTime(sorted, 2.0)?.id).toBe('b2_0')
    expect(beatAtTime(sorted, 2.26)?.id).toBe('b2_1')
    expect(beatAtTime(sorted, 99)?.id).toBe('b7_3')
  })

  it('keeps the floor beat early/mid-beat, snaps forward late in the beat', () => {
    // Beat duration 0.25 s; forward-snap window is the last 30 % = 0.075 s.
    expect(snapChordTimeToBeat(sorted, barsById, 2.0)?.id).toBe('b2_0') // on the beat
    expect(snapChordTimeToBeat(sorted, barsById, 2.1)?.id).toBe('b2_0') // mid-beat
    expect(snapChordTimeToBeat(sorted, barsById, 2.2)?.id).toBe('b2_1') // last 30 % → next
    expect(snapChordTimeToBeat(sorted, barsById, 7.9)?.id).toBe('b7_3') // last beat: no next
    expect(CHORD_SNAP_FORWARD_RATIO).toBeCloseTo(0.3)
  })
})

// ── placeChords ─────────────────────────────────────────────────────────────

describe('placeChords', () => {
  const SHEET = ['[Verse 1]', 'Am  C           G', 'Hold me now tonight'].join('\n')

  it('places word-anchored chords on snapped beats', () => {
    const sheet = parseChordSheet(SHEET)
    const map = buildMap({
      lyrics: {
        sourceText: sheet.lyricsText,
        words: words(['Hold', 1.0, 0], ['me', 1.26, 0], ['now', 1.51, 0], ['tonight', 2.0, 0]),
      },
    })
    const r = placeChords(sheet, map)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    const byToken = Object.fromEntries(r.plan.placements.map((p) => [p.chord.displayRaw, p.beatId]))
    expect(byToken['Am']).toBe('b1_0') // "Hold" at 1.0
    expect(byToken['C']).toBe('b1_1') // "me" at 1.26
    expect(byToken['G']).toBe('b2_0') // "tonight" at 2.0
    expect(r.plan.stats).toMatchObject({ placed: 3, estimated: 0, collisions: 0, unplaceable: 0 })
  })

  it('marks placements from interpolated words as estimated', () => {
    const sheet = parseChordSheet(SHEET)
    const map = buildMap({
      lyrics: {
        sourceText: sheet.lyricsText,
        words: words(['Hold', 1.0, 0, false], ['me', 1.26, 0], ['now', 1.51, 0], ['tonight', 2.0, 0]),
      },
    })
    const r = placeChords(sheet, map)
    expect(r.ok && r.plan.stats.estimated).toBe(1)
  })

  it('unrelated stored lyrics → no line matches, chords spread instead', () => {
    const sheet = parseChordSheet(SHEET)
    const map = buildMap({
      lyrics: {
        sourceText: 'totally different words entirely',
        words: words(['totally', 1, 0], ['different', 1.3, 0], ['words', 1.6, 0], ['entirely', 2, 0]),
      },
    })
    const r = placeChords(sheet, map)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.plan.stats.matchedLines).toBe(0)
    expect(r.plan.placements.every((p) => p.origin === 'spread')).toBe(true)
  })

  it('refuses only when lyrics have no timing at all', () => {
    const sheet = parseChordSheet(SHEET)
    const map = buildMap({ lyrics: { sourceText: 'Hold me now tonight', words: [] } })
    const r = placeChords(sheet, map)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toMatch(/fit the lyrics/i)
  })

  it('matches sheet lines to stored lyrics despite wording drift', () => {
    // Sheet says "Hold me now tonite" (typo); stored lyrics differ by one token.
    const sheet = parseChordSheet(['[Verse 1]', 'Am  C', 'Hold me now, tonite!'].join('\n'))
    const map = buildMap({
      lyrics: {
        sourceText: 'Hold me now tonight',
        words: words(['Hold', 1.0, 0], ['me', 1.26, 0], ['now', 1.51, 0], ['tonight', 2.0, 0]),
      },
    })
    const r = placeChords(sheet, map)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.plan.stats.matchedLines).toBe(1)
    const byToken = Object.fromEntries(r.plan.placements.map((p) => [p.chord.displayRaw, p.beatId]))
    expect(byToken['Am']).toBe('b1_0')
    expect(byToken['C']).toBe('b1_1')
  })

  it('a lazy sheet (skipped repeats) matches monotonically against full lyrics', () => {
    // Full lyrics: verse, chorus, chorus (repeated). Sheet only writes the
    // verse + ONE chorus — its chorus must match the FIRST chorus occurrence.
    const sheet = parseChordSheet(
      ['[Verse]', 'Am', 'Hold me now tonight', '', '[Chorus]', 'G', 'Sing it loud again'].join('\n'),
    )
    const map = buildMap({
      lyrics: {
        sourceText: 'Hold me now tonight\nSing it loud again\nSing it loud again',
        words: words(
          ['Hold', 1.0, 0], ['me', 1.2, 0], ['now', 1.4, 0], ['tonight', 1.6, 0],
          ['Sing', 3.0, 1], ['it', 3.2, 1], ['loud', 3.4, 1], ['again', 3.6, 1],
          ['Sing', 5.0, 2], ['it', 5.2, 2], ['loud', 5.4, 2], ['again', 5.6, 2],
        ),
      },
    })
    const r = placeChords(sheet, map)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.plan.stats.matchedLines).toBe(2)
    const g = r.plan.placements.find((p) => p.chord.displayRaw === 'G')!
    expect(g.beatId).toBe('b3_0') // first chorus occurrence (3.0s), not the later one
  })

  it('refuses without a beat grid', () => {
    const sheet = parseChordSheet(SHEET)
    const map = buildMap({ barCount: 0 })
    const r = placeChords(sheet, map)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toMatch(/analyze/i)
  })

  it('spreads an instrumental intro across the bars before the first anchor: 4 chords / 4 bars', () => {
    const sheet = parseChordSheet(
      ['[Intro]', 'G  Am  G  Am', '', '[Verse 1]', 'C', 'Hold me now tonight'].join('\n'),
    )
    const map = buildMap({
      lyrics: {
        sourceText: sheet.lyricsText,
        words: words(['Hold', 4.0, 0], ['me', 4.26, 0], ['now', 4.51, 0], ['tonight', 5.0, 0]),
      },
    })
    const r = placeChords(sheet, map)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    const spread = r.plan.placements.filter((p) => p.origin === 'spread')
    expect(spread.map((p) => p.beatId)).toEqual(['b0_0', 'b1_0', 'b2_0', 'b3_0'])
    expect(r.plan.stats.estimated).toBe(4)
  })

  it('doubles up mid-bar when the run has more chords than bars', () => {
    const sheet = parseChordSheet(
      ['[Intro]', 'G Am G Am G Am G Am', '', '[Verse 1]', 'C', 'Hold me now tonight'].join('\n'),
    )
    const map = buildMap({
      lyrics: {
        sourceText: sheet.lyricsText,
        words: words(['Hold', 4.0, 0], ['me', 4.26, 0], ['now', 4.51, 0], ['tonight', 5.0, 0]),
      },
    })
    const r = placeChords(sheet, map)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    const spread = r.plan.placements.filter((p) => p.origin === 'spread')
    expect(spread.map((p) => p.beatId)).toEqual([
      'b0_0', 'b0_2', 'b1_0', 'b1_2', 'b2_0', 'b2_2', 'b3_0', 'b3_2',
    ])
  })

  it('keeps the first chord on same-beat collisions and counts the rest', () => {
    const sheet = parseChordSheet(['[Verse 1]', 'Am C', 'Hold me now tonight'].join('\n'))
    const map = buildMap({
      lyrics: {
        sourceText: sheet.lyricsText,
        // Both anchor words land on the same beat.
        words: words(['Hold', 1.0, 0], ['me', 1.01, 0], ['now', 1.51, 0], ['tonight', 2.0, 0]),
      },
    })
    const r = placeChords(sheet, map)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.plan.stats.collisions).toBe(1)
    expect(r.plan.placements).toHaveLength(1)
    expect(r.plan.placements[0]!.chord.displayRaw).toBe('Am')
  })

  it('a fully instrumental sheet places without lyrics', () => {
    const sheet = parseChordSheet('[Intro]\nG  Am  C  D\n')
    const map = buildMap({})
    const r = placeChords(sheet, map)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.plan.placements).toHaveLength(4)
    expect(r.plan.placements.every((p) => p.origin === 'spread')).toBe(true)
  })
})

// ── applyChordPlacements ────────────────────────────────────────────────────

describe('applyChordPlacements', () => {
  it('writes placements as beat-anchored harmony rows', () => {
    const sheet = parseChordSheet(['[Verse 1]', 'Am  C', 'Hold me now tonight'].join('\n'))
    const map = buildMap({
      lyrics: {
        sourceText: sheet.lyricsText,
        words: words(['Hold', 1.0, 0], ['me', 1.26, 0], ['now', 1.51, 0], ['tonight', 2.0, 0]),
      },
    })
    const r = placeChords(sheet, map)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    const applied = applyChordPlacements(map, r.plan, newId)
    expect(applied.applied).toBe(2)
    expect(applied.failed).toBe(0)
    expect(applied.map.harmony).toHaveLength(2)
    const am = applied.map.harmony.find((h) => h.chord.displayRaw === 'Am')!
    expect(am.beatId).toBe('b1_0')
    expect(am.beatAnchor).toEqual({ indexInBar: 0 })
    expect(am.startSec).toBeCloseTo(1.0)
    expect(am.endSec).toBeCloseTo(1.25)
  })
})
