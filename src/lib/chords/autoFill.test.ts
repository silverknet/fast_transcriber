import { describe, expect, it } from 'vitest'
import { SONGMAP_FORMAT_VERSION } from '$lib/songmap/version'
import {
  applyChordAutoFill,
  beatsInSection,
  proposeChordAutoFillCandidates,
} from './autoFill'
import type {
  Bar,
  Beat,
  ChordSymbol,
  HarmonyEvent,
  NoteName,
  Section,
  SectionKind,
  SongMap,
} from '$lib/songmap/types'

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

function chord(root: NoteName, quality = 'major'): ChordSymbol {
  return { root, quality, displayRaw: root }
}

function harmony(beatId: string, barId: string, c: ChordSymbol, idSuffix = ''): HarmonyEvent {
  return {
    id: `h-${beatId}${idSuffix}`,
    barId,
    beatId,
    startSec: 0,
    endSec: 1,
    chord: c,
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
  barCount: number
  beatsPerBar?: number
  sections?: Section[]
  harmony?: HarmonyEvent[]
}): SongMap {
  const beatsPerBar = opts.beatsPerBar ?? 4
  const bars: Bar[] = []
  const beats: Beat[] = []
  for (let i = 0; i < opts.barCount; i++) {
    bars.push(bar(i, beatsPerBar))
    for (let j = 0; j < beatsPerBar; j++) beats.push(beat(i, j, beatsPerBar))
  }
  return {
    formatVersion: SONGMAP_FORMAT_VERSION,
    metadata: { title: 't', createdAt: '', updatedAt: '' },
    timeline: { bars, beats },
    sections: opts.sections ?? [],
    harmony: opts.harmony ?? [],
    cues: { mode: 'off', countInBeats: 0, useSectionLabels: false },
  } as unknown as SongMap
}

let id = 0
const newId = (): string => `gen-${++id}`

describe('beatsInSection', () => {
  it('returns the beats whose bars fall in the section range, in order', () => {
    const map = buildMap({
      barCount: 4,
      sections: [section('s', 'verse', 1, 2)],
    })
    const beats = beatsInSection(map, map.sections[0])
    expect(beats).toHaveLength(8) // 2 bars × 4 beats
    expect(beats[0].id).toBe('b1_0')
    expect(beats[beats.length - 1].id).toBe('b2_3')
  })
})

describe('proposeChordAutoFillCandidates — basic copy', () => {
  it('returns no proposals when no section has chords', () => {
    const map = buildMap({
      barCount: 16,
      sections: [section('s1', 'verse', 0, 7), section('s2', 'verse', 8, 15)],
    })
    expect(proposeChordAutoFillCandidates(map)).toEqual([])
  })

  it('returns one proposal for verse2 when verse1 has chords', () => {
    const map = buildMap({
      barCount: 16,
      sections: [section('s1', 'verse', 0, 7), section('s2', 'verse', 8, 15)],
      harmony: [
        harmony('b0_0', 'bar0', chord('C')),
        harmony('b1_0', 'bar1', chord('G')),
        harmony('b2_0', 'bar2', chord('A', 'minor')),
        harmony('b3_0', 'bar3', chord('F')),
      ],
    })
    const proposals = proposeChordAutoFillCandidates(map)
    expect(proposals).toHaveLength(1)
    const p = proposals[0]
    expect(p.sourceSection.id).toBe('s1')
    expect(p.targetSection.id).toBe('s2')
    expect(p.fillCount).toBe(4)
    expect(p.skippedExistingCount).toBe(0)
    // Verify the actual mapping for the first entry: bar0 b0 → bar8 b0
    const firstEntry = p.entries.find((e) => e.sourceBeatId === 'b0_0')
    expect(firstEntry?.targetBeatId).toBe('b8_0')
    expect(firstEntry?.chord.root).toBe('C')
  })
})

describe('proposeChordAutoFillCandidates — length mismatches', () => {
  it('target shorter than source → trailing chords are dropped', () => {
    // Source 0..7 (8 bars), target 8..11 (4 bars). Chords in source bars 5, 6, 7 should drop.
    const map = buildMap({
      barCount: 12,
      sections: [section('s1', 'chorus', 0, 7), section('s2', 'chorus', 8, 11)],
      harmony: [
        harmony('b0_0', 'bar0', chord('C')),
        harmony('b3_0', 'bar3', chord('F')),
        harmony('b5_0', 'bar5', chord('G')), // would map to bar 13 — doesn't exist
        harmony('b7_0', 'bar7', chord('A')), // would map to bar 15 — doesn't exist
      ],
    })
    const proposals = proposeChordAutoFillCandidates(map)
    expect(proposals).toHaveLength(1)
    expect(proposals[0].fillCount).toBe(2) // only bar0 + bar3 fit
    const targetBars = proposals[0].entries.map((e) => e.targetBeatId)
    expect(targetBars).toEqual(['b8_0', 'b11_0'])
  })

  it('target longer than source → trailing bars stay empty', () => {
    // Source 0..3 (4 bars), target 4..11 (8 bars). All source chords fit; no extras.
    const map = buildMap({
      barCount: 12,
      sections: [section('s1', 'verse', 0, 3), section('s2', 'verse', 4, 11)],
      harmony: [
        harmony('b0_0', 'bar0', chord('C')),
        harmony('b1_0', 'bar1', chord('G')),
        harmony('b2_0', 'bar2', chord('A', 'minor')),
        harmony('b3_0', 'bar3', chord('F')),
      ],
    })
    const proposals = proposeChordAutoFillCandidates(map)
    expect(proposals).toHaveLength(1)
    expect(proposals[0].fillCount).toBe(4)
  })
})

describe('proposeChordAutoFillCandidates — non-destructive', () => {
  it('skips target beats that already have chords; reports skippedExistingCount', () => {
    const map = buildMap({
      barCount: 16,
      sections: [section('s1', 'verse', 0, 7), section('s2', 'verse', 8, 15)],
      harmony: [
        harmony('b0_0', 'bar0', chord('C')),
        harmony('b1_0', 'bar1', chord('G')),
        // Target already has a chord at bar8 (the corresponding position to bar0 in source).
        harmony('b8_0', 'bar8', chord('D'), '-existing'),
      ],
    })
    const proposals = proposeChordAutoFillCandidates(map)
    expect(proposals).toHaveLength(1)
    expect(proposals[0].fillCount).toBe(1) // only bar1 → bar9 fills
    expect(proposals[0].skippedExistingCount).toBe(1)
  })
})

describe('proposeChordAutoFillCandidates — multiple candidates', () => {
  it('ranks chronologically by target start bar', () => {
    // intro, verse1, chorus1 with chords, verse2 (empty), chorus2 (empty)
    const map = buildMap({
      barCount: 32,
      sections: [
        section('s_int', 'intro', 0, 3),
        section('s_v1', 'verse', 4, 11),
        section('s_c1', 'chorus', 12, 19),
        section('s_v2', 'verse', 20, 27),
        section('s_c2', 'chorus', 28, 31),
      ],
      harmony: [
        harmony('b4_0', 'bar4', chord('C')),
        harmony('b5_0', 'bar5', chord('G')),
        harmony('b12_0', 'bar12', chord('F')),
        harmony('b13_0', 'bar13', chord('A', 'minor')),
      ],
    })
    const proposals = proposeChordAutoFillCandidates(map)
    expect(proposals).toHaveLength(2)
    // verse2 (target start 20) should come before chorus2 (target start 28)
    expect(proposals[0].targetSection.id).toBe('s_v2')
    expect(proposals[1].targetSection.id).toBe('s_c2')
  })

  it('caps at MAX_AUTOFILL_CANDIDATES (5)', () => {
    // 1 verse with chords + 6 empty verses → 6 proposals raw → capped to 5.
    const sections: Section[] = [section('s_v0', 'verse', 0, 3)]
    for (let i = 1; i <= 6; i++) {
      sections.push(section(`s_v${i}`, 'verse', i * 4, i * 4 + 3))
    }
    const map = buildMap({
      barCount: 32,
      sections,
      harmony: [
        harmony('b0_0', 'bar0', chord('C')),
        harmony('b1_0', 'bar1', chord('G')),
      ],
    })
    const proposals = proposeChordAutoFillCandidates(map)
    expect(proposals).toHaveLength(5)
  })

  it('does not emit a proposal when source = target (single section of a kind)', () => {
    const map = buildMap({
      barCount: 8,
      sections: [section('s_bridge', 'bridge', 0, 7)],
      harmony: [harmony('b0_0', 'bar0', chord('C'))],
    })
    expect(proposeChordAutoFillCandidates(map)).toEqual([])
  })
})

describe('applyChordAutoFill', () => {
  it('writes every entry via upsertHarmonyAtBeat', () => {
    id = 0
    const map = buildMap({
      barCount: 16,
      sections: [section('s1', 'verse', 0, 7), section('s2', 'verse', 8, 15)],
      harmony: [
        harmony('b0_0', 'bar0', chord('C')),
        harmony('b1_0', 'bar1', chord('G')),
      ],
    })
    const proposals = proposeChordAutoFillCandidates(map)
    expect(proposals).toHaveLength(1)
    const out = applyChordAutoFill(map, proposals[0], newId)
    expect(out.ok).toBe(true)
    if (!out.ok) return
    expect(out.map.harmony).toHaveLength(4) // 2 original + 2 filled
    // Verify the target beats now have chords matching the source.
    const targetEvents = out.map.harmony.filter(
      (h) => h.beatId === 'b8_0' || h.beatId === 'b9_0',
    )
    expect(targetEvents).toHaveLength(2)
    expect(targetEvents.find((h) => h.beatId === 'b8_0')?.chord.root).toBe('C')
    expect(targetEvents.find((h) => h.beatId === 'b9_0')?.chord.root).toBe('G')
  })

  it('is idempotent — re-applying produces the same result', () => {
    id = 0
    let map = buildMap({
      barCount: 16,
      sections: [section('s1', 'verse', 0, 7), section('s2', 'verse', 8, 15)],
      harmony: [harmony('b0_0', 'bar0', chord('C'))],
    })
    const proposal1 = proposeChordAutoFillCandidates(map)[0]
    const out1 = applyChordAutoFill(map, proposal1, newId)
    expect(out1.ok).toBe(true)
    if (out1.ok) map = out1.map

    // After applying, the proposal becomes empty (target now has the chord).
    const proposalsAfter = proposeChordAutoFillCandidates(map)
    expect(proposalsAfter).toEqual([])
    // And harmony count is exactly source (1) + target (1).
    expect(map.harmony).toHaveLength(2)
  })
})
