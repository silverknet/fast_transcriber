import { describe, expect, it } from 'vitest'
import { SONGMAP_FORMAT_VERSION } from '$lib/songmap/version'
import { generateChartHints } from './analyze'
import type {
  Bar,
  ChordSymbol,
  HarmonyEvent,
  NoteName,
  Section,
  SectionKind,
  SongMap,
} from '$lib/songmap/types'

function bar(index: number): Bar {
  return {
    id: `b${index}`,
    index,
    startSec: index,
    endSec: index + 1,
    meter: { numerator: 4, denominator: 4 },
    beatCount: 4,
    beatIds: [],
  }
}

function chord(root: NoteName, quality = 'major'): ChordSymbol {
  return { root, quality, displayRaw: root }
}

function harmony(barId: string, indexInBar: number, c: ChordSymbol): HarmonyEvent {
  return {
    id: `h-${barId}-${indexInBar}`,
    barId,
    startSec: 0,
    endSec: 1,
    chord: c,
    beatAnchor: { indexInBar },
  }
}

function section(
  id: string,
  kind: SectionKind,
  startBarIndex: number,
  endBarIndex: number,
): Section {
  return { id, kind, label: kind, barRange: { startBarIndex, endBarIndex } }
}

function buildMap(opts: {
  bars: Bar[]
  harmony?: HarmonyEvent[]
  sections?: Section[]
}): SongMap {
  return {
    formatVersion: SONGMAP_FORMAT_VERSION,
    metadata: { title: 't', createdAt: '', updatedAt: '' },
    timeline: { bars: opts.bars, beats: [] },
    sections: opts.sections ?? [],
    harmony: opts.harmony ?? [],
    cues: { mode: 'off', countInBeats: 0, useSectionLabels: false },
  } as unknown as SongMap
}

describe('generateChartHints — empty bars', () => {
  it('bars with no chords yet (lead-in) are N.C.', () => {
    const map = buildMap({ bars: [bar(0), bar(1)] })
    const hints = generateChartHints(map)
    expect(hints.bars.get('b0')?.display).toBe('nc')
    expect(hints.bars.get('b1')?.display).toBe('nc')
  })

  it('an empty bar right after a chord is simile', () => {
    const map = buildMap({
      bars: [bar(0), bar(1)],
      harmony: [harmony('b0', 0, chord('C'))],
    })
    const hints = generateChartHints(map)
    expect(hints.bars.get('b1')?.display).toBe('simile')
  })

  it('an empty bar more than 4 bars after the last chord goes back to N.C.', () => {
    // bars 0..6 — chord only on bar 0, bars 1..4 are simile, bar 5+ are N.C.
    const bars = [0, 1, 2, 3, 4, 5, 6].map(bar)
    const map = buildMap({
      bars,
      harmony: [harmony('b0', 0, chord('C'))],
    })
    const hints = generateChartHints(map)
    expect(hints.bars.get('b1')?.display).toBe('simile')
    expect(hints.bars.get('b4')?.display).toBe('simile')
    expect(hints.bars.get('b5')?.display).toBe('nc')
    expect(hints.bars.get('b6')?.display).toBe('nc')
  })
})

describe('generateChartHints — repeat (x2) collapse', () => {
  it('two identical adjacent same-kind sections collapse with x2 and B is skipped', () => {
    const map = buildMap({
      bars: [0, 1, 2, 3, 4, 5, 6, 7].map(bar),
      harmony: [
        // Verse 1
        harmony('b0', 0, chord('C')),
        harmony('b1', 0, chord('G')),
        harmony('b2', 0, chord('A', 'minor')),
        harmony('b3', 0, chord('F')),
        // Verse 2 — identical
        harmony('b4', 0, chord('C')),
        harmony('b5', 0, chord('G')),
        harmony('b6', 0, chord('A', 'minor')),
        harmony('b7', 0, chord('F')),
      ],
      sections: [
        section('s1', 'verse', 0, 3),
        section('s2', 'verse', 4, 7),
      ],
    })
    const hints = generateChartHints(map)
    expect(hints.bars.get('b0')?.repeatOpen).toBe(true)
    expect(hints.bars.get('b3')?.repeatClose).toBe(true)
    expect(hints.bars.get('b3')?.repeatCount).toBe(2)
    for (const id of ['b4', 'b5', 'b6', 'b7']) {
      expect(hints.bars.get(id)?.display).toBe('skip')
    }
  })

  it('different-kind sections do NOT collapse even if chords match', () => {
    const map = buildMap({
      bars: [0, 1, 2, 3].map(bar),
      harmony: [
        harmony('b0', 0, chord('C')),
        harmony('b1', 0, chord('F')),
        harmony('b2', 0, chord('C')),
        harmony('b3', 0, chord('F')),
      ],
      sections: [section('s1', 'verse', 0, 1), section('s2', 'chorus', 2, 3)],
    })
    const hints = generateChartHints(map)
    expect(hints.bars.get('b2')?.display).not.toBe('skip')
    expect(hints.bars.get('b0')?.repeatOpen).toBeUndefined()
  })

  it('sections with totally different chords do NOT collapse and do NOT get a volta', () => {
    const map = buildMap({
      bars: [0, 1, 2, 3].map(bar),
      harmony: [
        harmony('b0', 0, chord('C')),
        harmony('b1', 0, chord('G')),
        harmony('b2', 0, chord('D')),
        harmony('b3', 0, chord('A')),
      ],
      sections: [section('s1', 'verse', 0, 1), section('s2', 'verse', 2, 3)],
    })
    const hints = generateChartHints(map)
    for (const id of ['b0', 'b1', 'b2', 'b3']) {
      const h = hints.bars.get(id) ?? { display: 'normal' }
      expect(h.display).not.toBe('skip')
      expect(h.repeatOpen).toBeUndefined()
      expect(h.voltaStart).toBeUndefined()
    }
  })
})

describe('generateChartHints — first/second ending (volta)', () => {
  it('two same-kind sections diverging only at the tail get volta brackets', () => {
    // Both choruses: C G Am | F  vs  C G Am | G
    // Prefix = 3 bars (C, G, Am), divergent tail = 1 bar (F vs G)
    const map = buildMap({
      bars: [0, 1, 2, 3, 4, 5, 6, 7].map(bar),
      harmony: [
        harmony('b0', 0, chord('C')),
        harmony('b1', 0, chord('G')),
        harmony('b2', 0, chord('A', 'minor')),
        harmony('b3', 0, chord('F')),
        harmony('b4', 0, chord('C')),
        harmony('b5', 0, chord('G')),
        harmony('b6', 0, chord('A', 'minor')),
        harmony('b7', 0, chord('G')),
      ],
      sections: [
        section('s1', 'chorus', 0, 3),
        section('s2', 'chorus', 4, 7),
      ],
    })
    const hints = generateChartHints(map)
    // |: opens at b0
    expect(hints.bars.get('b0')?.repeatOpen).toBe(true)
    // Volta 1 starts on b3 (the divergent F)
    expect(hints.bars.get('b3')?.voltaStart).toBe('1.')
    expect(hints.bars.get('b3')?.voltaEnd).toBe(true)
    expect(hints.bars.get('b3')?.repeatClose).toBe(true)
    // Shared prefix of B (b4..b6) is skipped
    expect(hints.bars.get('b4')?.display).toBe('skip')
    expect(hints.bars.get('b5')?.display).toBe('skip')
    expect(hints.bars.get('b6')?.display).toBe('skip')
    // Volta 2 starts on b7 (the divergent G)
    expect(hints.bars.get('b7')?.voltaStart).toBe('2.')
    expect(hints.bars.get('b7')?.voltaEnd).toBe(true)
  })
})

describe('generateChartHints — bar numbers', () => {
  it('numbers every 4 bars, 1-indexed', () => {
    const map = buildMap({ bars: [0, 1, 2, 3, 4, 5, 6, 7, 8].map(bar) })
    const hints = generateChartHints(map)
    expect(hints.bars.get('b0')?.barNumber).toBe(1)
    expect(hints.bars.get('b1')?.barNumber).toBeUndefined()
    expect(hints.bars.get('b4')?.barNumber).toBe(5)
    expect(hints.bars.get('b8')?.barNumber).toBe(9)
  })
})
