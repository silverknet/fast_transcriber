import { describe, expect, it } from 'vitest'
import { SONGMAP_FORMAT_VERSION } from '$lib/songmap/version'
import {
  aggregateBarChroma,
  proposeChordSuggestions,
  rankTriadFitsForChroma,
} from './suggestFromChroma'
import type {
  Bar,
  Beat,
  ChordHints,
  SongKey,
  SongMap,
} from '$lib/songmap/types'

/** Build a 12-d chroma with `weight` on each listed pitch class, L1-normalized. */
function chromaFor(pitchClasses: number[]): number[] {
  const c = Array.from({ length: 12 }, () => 0)
  for (const pc of pitchClasses) c[pc % 12] += 1
  const sum = c.reduce((s, v) => s + v, 0)
  return c.map((v) => (sum > 0 ? v / sum : 0))
}

describe('rankTriadFitsForChroma', () => {
  it('picks C major from a C-major triad chroma (C, E, G)', () => {
    const ranked = rankTriadFitsForChroma(chromaFor([0, 4, 7]), undefined)
    expect(ranked[0].pc).toBe(0)
    expect(ranked[0].quality).toBe('major')
  })

  it('picks A minor from an A-minor triad chroma (A, C, E)', () => {
    const ranked = rankTriadFitsForChroma(chromaFor([9, 0, 4]), undefined)
    expect(ranked[0].pc).toBe(9)
    expect(ranked[0].quality).toBe('minor')
  })

  it('applies diatonic bias toward in-key chords on close calls', () => {
    // Build an ambiguous chroma evenly split between C major (0,4,7) and
    // C# major (1,5,8). Without a key, the algorithm picks one or the other
    // by tie-breaker. With C major key set, the diatonic bias should
    // resolve to C (in-key) over C# (not in C major).
    const ambiguous = chromaFor([0, 4, 7, 1, 5, 8])
    const noKey = rankTriadFitsForChroma(ambiguous, undefined)
    const withKey = rankTriadFitsForChroma(ambiguous, { root: 'C', mode: 'major' } as SongKey)
    // With key: C must rank above C# (the bias is the only differentiator).
    const cIdx = withKey.findIndex((s) => s.pc === 0 && s.quality === 'major')
    const cSharpIdx = withKey.findIndex((s) => s.pc === 1 && s.quality === 'major')
    expect(cIdx).toBeLessThan(cSharpIdx)
    // Sanity: bias also affected the no-key vs with-key ordering.
    expect(noKey).not.toEqual(withKey)
  })
})

describe('aggregateBarChroma', () => {
  it('averages chroma frames and L1-normalizes the result', () => {
    const chroma = [chromaFor([0]), chromaFor([4]), chromaFor([7]), chromaFor([0])]
    const result = aggregateBarChroma([0, 1, 2, 3], chroma)
    expect(result).not.toBeNull()
    const sum = result!.reduce((s, v) => s + v, 0)
    expect(sum).toBeCloseTo(1, 5)
    // C should be twice as heavy as E or G (appeared in 2 of 4 frames).
    expect(result![0]).toBeGreaterThan(result![4])
    expect(result![0]).toBeGreaterThan(result![7])
  })

  it('returns null when all chroma frames are empty', () => {
    const empty = [Array(12).fill(0), Array(12).fill(0)]
    expect(aggregateBarChroma([0, 1], empty)).toBeNull()
  })

  it('returns null when no beat indices supplied', () => {
    expect(aggregateBarChroma([], [chromaFor([0])])).toBeNull()
  })

  it('skips out-of-range or malformed chroma entries', () => {
    const chroma = [chromaFor([0]), [], chromaFor([4])]
    const result = aggregateBarChroma([0, 1, 2], chroma as number[][])
    expect(result).not.toBeNull()
    // Only valid frames (0 and 2) contributed.
    expect(result![0]).toBeGreaterThan(0)
    expect(result![4]).toBeGreaterThan(0)
  })
})

function bar(index: number, beatIds: string[]): Bar {
  return {
    id: `bar${index}`,
    index,
    startSec: index,
    endSec: index + 1,
    meter: { numerator: beatIds.length, denominator: 4 },
    beatCount: beatIds.length,
    beatIds,
  }
}

function beat(barIndex: number, indexInBar: number): Beat {
  return {
    id: `b${barIndex}_${indexInBar}`,
    barId: `bar${barIndex}`,
    indexInBar,
    timeSec: barIndex + indexInBar / 4,
  }
}

function buildSongMap(opts: {
  bars: Bar[]
  beats: Beat[]
  hints?: ChordHints | undefined
  songKey?: SongKey
  sections?: import('$lib/songmap/types').Section[]
  harmony?: import('$lib/songmap/types').HarmonyEvent[]
}): SongMap {
  return {
    formatVersion: SONGMAP_FORMAT_VERSION,
    metadata: {
      title: 't',
      createdAt: '',
      updatedAt: '',
      ...(opts.songKey ? { keyDetail: opts.songKey } : {}),
    },
    timeline: { bars: opts.bars, beats: opts.beats },
    sections: opts.sections ?? [],
    harmony: opts.harmony ?? [],
    cues: { mode: 'off', countInBeats: 0, useSectionLabels: false },
    ...(opts.hints ? { chordHints: opts.hints } : {}),
  } as unknown as SongMap
}

describe('proposeChordSuggestions', () => {
  it('returns an empty map when chordHints is missing', () => {
    const map = buildSongMap({
      bars: [bar(0, ['b0_0', 'b0_1', 'b0_2', 'b0_3'])],
      beats: [beat(0, 0), beat(0, 1), beat(0, 2), beat(0, 3)],
    })
    expect(proposeChordSuggestions(map).size).toBe(0)
  })

  it('returns one suggestion per bar keyed by the downbeat id', () => {
    const bars: Bar[] = [
      bar(0, ['b0_0', 'b0_1', 'b0_2', 'b0_3']),
      bar(1, ['b1_0', 'b1_1', 'b1_2', 'b1_3']),
    ]
    const beats: Beat[] = []
    for (let i = 0; i < 2; i++) {
      for (let j = 0; j < 4; j++) beats.push(beat(i, j))
    }
    // Bar 0: every beat strongly suggests C major. Bar 1: every beat A minor.
    const cMaj = chromaFor([0, 4, 7])
    const aMin = chromaFor([9, 0, 4])
    const beatChroma = [cMaj, cMaj, cMaj, cMaj, aMin, aMin, aMin, aMin]
    const hints: ChordHints = {
      beatChroma,
      detectedKey: null,
      audioFingerprint: 'fake',
      generatedAt: '',
      analyzerVersion: 2,
    }
    const map = buildSongMap({ bars, beats, hints })
    const out = proposeChordSuggestions(map)
    expect(out.size).toBe(2)
    expect(out.get('b0_0')?.chord.root).toBe('C')
    expect(out.get('b0_0')?.chord.quality).toBe('major')
    expect(out.get('b1_0')?.chord.root).toBe('A')
    expect(out.get('b1_0')?.chord.quality).toBe('minor')
  })

  it('omits bars below MIN_SUGGESTION_CONFIDENCE', () => {
    const bars: Bar[] = [bar(0, ['b0_0', 'b0_1', 'b0_2', 'b0_3'])]
    const beats: Beat[] = [beat(0, 0), beat(0, 1), beat(0, 2), beat(0, 3)]
    // Uniform chroma — every key fits equally → confidence ~0 → omitted.
    const flat = Array(12).fill(1 / 12)
    const hints: ChordHints = {
      beatChroma: [flat, flat, flat, flat],
      detectedKey: null,
      audioFingerprint: 'fake',
      generatedAt: '',
      analyzerVersion: 2,
    }
    const map = buildSongMap({ bars, beats, hints })
    expect(proposeChordSuggestions(map).size).toBe(0)
  })

  it('exposes up to 2 alternatives for each suggestion', () => {
    const bars: Bar[] = [bar(0, ['b0_0', 'b0_1', 'b0_2', 'b0_3'])]
    const beats: Beat[] = [beat(0, 0), beat(0, 1), beat(0, 2), beat(0, 3)]
    const cMaj = chromaFor([0, 4, 7])
    const hints: ChordHints = {
      beatChroma: [cMaj, cMaj, cMaj, cMaj],
      detectedKey: null,
      audioFingerprint: 'fake',
      generatedAt: '',
      analyzerVersion: 2,
    }
    const map = buildSongMap({ bars, beats, hints })
    const s = proposeChordSuggestions(map).get('b0_0')
    expect(s).toBeDefined()
    // SUGGESTION_TOP_N = 5 → primary + 4 alternates. Wider safety net
    // so the radial can offer ~95% in-radial coverage even when top-1
    // misses (e.g. true chord is Cmaj7, model says C major).
    expect(s!.alternatives.length).toBe(4)
    // Alternatives should be different from the primary.
    for (const alt of s!.alternatives) {
      expect(alt.root === s!.chord.root && alt.quality === s!.chord.quality).toBe(false)
    }
  })

  it('uses preferred-flats spelling when song key uses flats', () => {
    const bars: Bar[] = [bar(0, ['b0_0', 'b0_1', 'b0_2', 'b0_3'])]
    const beats: Beat[] = [beat(0, 0), beat(0, 1), beat(0, 2), beat(0, 3)]
    // Bb major chroma: Bb=10, D=2, F=5
    const bbMaj = chromaFor([10, 2, 5])
    const hints: ChordHints = {
      beatChroma: [bbMaj, bbMaj, bbMaj, bbMaj],
      detectedKey: null,
      audioFingerprint: 'fake',
      generatedAt: '',
      analyzerVersion: 2,
    }
    const map = buildSongMap({
      bars,
      beats,
      hints,
      songKey: { root: 'F', mode: 'major' } as SongKey, // F major prefers flats
    })
    const s = proposeChordSuggestions(map).get('b0_0')
    expect(s?.chord.root).toBe('B')
    expect(s?.chord.accidental).toBe('flat')
  })
})

describe('proposeChordSuggestions — section bias', () => {
  // Build a 2-verse song where verse 1 (bars 0..1) has F placed on
  // beat 0 of bar 0, and verse 2 (bars 2..3) has chroma ambiguous
  // between C and F. Section bias should resolve verse 2's bar 0
  // (== bar 2) to F because the matching beat of verse 1 is F.
  function buildTwoVerseMap(opts?: { withSectionHarmony?: boolean }) {
    const bars: Bar[] = [
      { ...bar(0, ['b0_0', 'b0_1', 'b0_2', 'b0_3']) },
      { ...bar(1, ['b1_0', 'b1_1', 'b1_2', 'b1_3']) },
      { ...bar(2, ['b2_0', 'b2_1', 'b2_2', 'b2_3']) },
      { ...bar(3, ['b3_0', 'b3_1', 'b3_2', 'b3_3']) },
    ]
    const beats: Beat[] = []
    for (let i = 0; i < 4; i++) {
      for (let j = 0; j < 4; j++) beats.push(beat(i, j))
    }
    // Chroma: bars 0..1 strong F major (verse 1); bars 2..3 ambiguous
    // between C and F. Without section bias, bar 2 would lean C; with
    // bias, it should reflect F (matching verse 1 bar 0).
    const fMaj = chromaFor([5, 9, 0]) // F, A, C
    const ambiguous = chromaFor([0, 4, 7, 5, 9, 0]) // C-major + F-major mix
    const beatChroma = [
      ...Array(4).fill(fMaj),
      ...Array(4).fill(fMaj),
      ...Array(4).fill(ambiguous),
      ...Array(4).fill(ambiguous),
    ]
    const hints: ChordHints = {
      beatChroma,
      detectedKey: null,
      audioFingerprint: 'fake',
      generatedAt: '',
      analyzerVersion: 3,
    }
    const sections: import('$lib/songmap/types').Section[] = [
      { id: 'v1', kind: 'verse', label: 'verse', barRange: { startBarIndex: 0, endBarIndex: 1 } },
      { id: 'v2', kind: 'verse', label: 'verse', barRange: { startBarIndex: 2, endBarIndex: 3 } },
    ]
    const harmony: import('$lib/songmap/types').HarmonyEvent[] = opts?.withSectionHarmony
      ? [
          {
            id: 'h1',
            barId: 'bar0',
            beatId: 'b0_0',
            startSec: 0,
            endSec: 1,
            chord: { root: 'F', quality: 'major', displayRaw: 'F' },
          },
        ]
      : []
    return buildSongMap({ bars, beats, hints, sections, harmony })
  }

  it('flips ambiguous bar to the same-kind earlier section chord when bias is on', () => {
    const map = buildTwoVerseMap({ withSectionHarmony: true })
    const withBias = proposeChordSuggestions(map).get('b2_0')
    expect(withBias?.chord.root).toBe('F')
  })

  it('respects useSectionBias=false (debug A/B mode)', () => {
    const map = buildTwoVerseMap({ withSectionHarmony: true })
    const noBias = proposeChordSuggestions(map, { useSectionBias: false }).get('b2_0')
    // Without the section bias, ambiguous chroma falls to its chroma-only winner.
    // Just assert that the result differs from the section-biased one.
    expect(noBias?.chord.root).not.toBe('F')
  })

  it('no-op when there is no matching earlier-section chord', () => {
    const map = buildTwoVerseMap({ withSectionHarmony: false })
    const s = proposeChordSuggestions(map).get('b2_0')
    // Same result with or without bias since there's no anchor chord
    // to bias toward.
    const sNoBias = proposeChordSuggestions(map, { useSectionBias: false }).get('b2_0')
    expect(s?.chord.root).toBe(sNoBias?.chord.root)
  })
})
