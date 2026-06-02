import { describe, expect, it } from 'vitest'
import { createEmptySongMap } from '$lib/songmap/factory'
import { predictNextSection, predictNextSectionCandidates } from './predictNext'
import type { Bar, Section, SectionKind, SongMap } from '$lib/songmap/types'

function bar(index: number): Bar {
  return {
    id: `bar${index}`,
    index,
    startSec: index,
    endSec: index + 1,
    meter: { numerator: 4, denominator: 4 },
    beatCount: 4,
    beatIds: [],
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

function build(barsCount: number, sections: Section[]): SongMap {
  const base = createEmptySongMap({ now: () => '2020-01-01T00:00:00.000Z' })
  const bars: Bar[] = []
  for (let i = 0; i < barsCount; i++) bars.push(bar(i))
  return { ...base, timeline: { bars, beats: [] }, sections }
}

describe('predictNextSection — cold start & termination', () => {
  it('returns null for an empty song (no sections)', () => {
    const map = build(64, [])
    expect(predictNextSection(map)).toBeNull()
  })

  it('returns null after an outro', () => {
    const map = build(64, [section('s1', 'outro', 0, 3)])
    expect(predictNextSection(map)).toBeNull()
  })

  it('returns null after a custom section (we do not guess)', () => {
    const map = build(64, [section('s1', 'custom', 0, 3)])
    expect(predictNextSection(map)).toBeNull()
  })
})

describe('predictNextSection — transition rules', () => {
  it('intro → verse', () => {
    const map = build(64, [section('s1', 'intro', 0, 3)])
    const out = predictNextSection(map)
    expect(out?.kind).toBe('verse')
  })

  it('verse → chorus when no pre-chorus has been used', () => {
    const map = build(64, [
      section('s1', 'intro', 0, 3),
      section('s2', 'verse', 4, 11),
    ])
    const out = predictNextSection(map)
    expect(out?.kind).toBe('chorus')
  })

  it('verse → preChorus when a pre-chorus existed earlier in the song', () => {
    const map = build(64, [
      section('s1', 'verse', 0, 7),
      section('s2', 'preChorus', 8, 11),
      section('s3', 'chorus', 12, 19),
      section('s4', 'verse', 20, 27),
    ])
    const out = predictNextSection(map)
    expect(out?.kind).toBe('preChorus')
  })

  it('preChorus → chorus', () => {
    const map = build(64, [
      section('s1', 'verse', 0, 7),
      section('s2', 'preChorus', 8, 11),
    ])
    const out = predictNextSection(map)
    expect(out?.kind).toBe('chorus')
  })

  it('after second chorus and no bridge → bridge', () => {
    const map = build(96, [
      section('s1', 'verse', 0, 7),
      section('s2', 'chorus', 8, 15),
      section('s3', 'verse', 16, 23),
      section('s4', 'chorus', 24, 31),
    ])
    const out = predictNextSection(map)
    expect(out?.kind).toBe('bridge')
  })

  it('bridge → chorus', () => {
    const map = build(96, [
      section('s1', 'verse', 0, 7),
      section('s2', 'chorus', 8, 15),
      section('s3', 'verse', 16, 23),
      section('s4', 'chorus', 24, 31),
      section('s5', 'bridge', 32, 39),
    ])
    const out = predictNextSection(map)
    expect(out?.kind).toBe('chorus')
  })

  it('solo → chorus', () => {
    const map = build(96, [
      section('s1', 'verse', 0, 7),
      section('s2', 'chorus', 8, 15),
      section('s3', 'solo', 16, 23),
    ])
    const out = predictNextSection(map)
    expect(out?.kind).toBe('chorus')
  })

  it('riff is transparent — looks past it to the previous driver', () => {
    const map = build(96, [
      section('s1', 'intro', 0, 3),
      section('s2', 'riff', 4, 7),
    ])
    const out = predictNextSection(map)
    // intro → verse, regardless of the riff between them
    expect(out?.kind).toBe('verse')
  })
})

describe('predictNextSection — length prediction', () => {
  it('uses the most-frequent prior bar count for the predicted kind', () => {
    // Two verses of 8 bars each are in the song; predict next verse as 8.
    const map = build(96, [
      section('s1', 'verse', 0, 7),
      section('s2', 'chorus', 8, 15),
      section('s3', 'verse', 16, 23),
      section('s4', 'chorus', 24, 31),
    ])
    // Bridge predicted next — bridge never seen, default 8.
    const out = predictNextSection(map)
    expect(out?.kind).toBe('bridge')
    expect(out?.bars).toBe(8)
  })

  it('mirrors a 4-bar verse pattern from earlier in the song', () => {
    const map = build(64, [
      section('s1', 'verse', 0, 3),
      section('s2', 'chorus', 4, 11),
    ])
    // chorus → verse (chorusCount === 1, verseCount === 1 → fall through);
    // verse predicted, bars should mirror prior 4-bar verse.
    const out = predictNextSection(map)
    expect(out?.kind).toBe('verse')
    expect(out?.bars).toBe(4)
  })
})

describe('predictNextSection — audio-border-driven length', () => {
  it('uses an audio border to set the suggested bar count when confident', () => {
    // Verse 0..7 ends; rule-based length would be 4 (default for preChorus).
    // Audio detects a border at bar 16 → should suggest 8 bars (16 - 8).
    const map = build(64, [
      section('s1', 'verse', 0, 7),
      section('s2', 'preChorus', 8, 11),
      section('s3', 'chorus', 12, 19),
      section('s4', 'verse', 20, 27),
    ])
    const out = predictNextSection(map, {
      audioBorders: [
        { bar: 28, confidence: 0.55 }, // a border right at start of next section — ignored (≤ nextStart)
        { bar: 36, confidence: 0.72 }, // detected border 8 bars after nextStart=28
      ],
    })
    expect(out?.kind).toBe('preChorus')
    expect(out?.bars).toBe(8)
    expect(out?.reason).toContain('audio detected a change')
  })

  it('ignores low-confidence audio borders and falls back to rule-based length', () => {
    const map = build(64, [
      section('s1', 'verse', 0, 7),
      section('s2', 'preChorus', 8, 11),
      section('s3', 'chorus', 12, 19),
      section('s4', 'verse', 20, 27),
    ])
    const out = predictNextSection(map, {
      audioBorders: [{ bar: 36, confidence: 0.1 }], // below the floor
    })
    expect(out?.kind).toBe('preChorus')
    expect(out?.bars).toBe(4) // default preChorus length
    expect(out?.reason).not.toContain('audio detected')
  })

  it('ignores audio borders that are too far away', () => {
    const map = build(64, [
      section('s1', 'verse', 0, 7),
      section('s2', 'preChorus', 8, 11),
      section('s3', 'chorus', 12, 19),
      section('s4', 'verse', 20, 27),
    ])
    const out = predictNextSection(map, {
      audioBorders: [{ bar: 50, confidence: 0.9 }], // 22 bars away, too far
    })
    expect(out?.bars).toBe(4)
    expect(out?.reason).not.toContain('audio detected')
  })

  it('ignores audio borders that are too close (< 2 bars after nextStart)', () => {
    const map = build(64, [
      section('s1', 'verse', 0, 7),
      section('s2', 'preChorus', 8, 11),
      section('s3', 'chorus', 12, 19),
      section('s4', 'verse', 20, 27),
    ])
    const out = predictNextSection(map, {
      audioBorders: [{ bar: 29, confidence: 0.9 }], // 1 bar after nextStart=28 — too close
    })
    expect(out?.bars).toBe(4)
    expect(out?.reason).not.toContain('audio detected')
  })

  it('still returns null when no kind can be predicted, even with audio borders', () => {
    const map = build(64, [section('s1', 'outro', 0, 3)])
    const out = predictNextSection(map, {
      audioBorders: [{ bar: 8, confidence: 0.9 }],
    })
    expect(out).toBeNull()
  })
})

describe('predictNextSection — bounds', () => {
  it('returns null when the predicted range would overrun the timeline', () => {
    // Timeline has only 16 bars, last section ends at 14, suggestion would be 8 bars → overruns.
    const map = build(16, [
      section('s1', 'verse', 0, 7),
      section('s2', 'preChorus', 8, 11),
      section('s3', 'verse', 12, 14),
    ])
    // verse → preChorus (which exists), preChorus default 4 bars; would land at 15..18 → overrun.
    const out = predictNextSection(map)
    expect(out).toBeNull()
  })
})

describe('predictNextSectionCandidates — ranked list', () => {
  it('returns an empty array for cold start', () => {
    expect(predictNextSectionCandidates(build(64, []))).toEqual([])
  })

  it('returns an empty array after outro / custom', () => {
    expect(
      predictNextSectionCandidates(build(64, [section('s1', 'outro', 0, 3)])),
    ).toEqual([])
    expect(
      predictNextSectionCandidates(build(64, [section('s1', 'custom', 0, 3)])),
    ).toEqual([])
  })

  it('returns multiple candidates after a verse — preChorus + chorus + verse', () => {
    const map = build(64, [section('s1', 'verse', 0, 7)])
    const out = predictNextSectionCandidates(map)
    const kinds = out.map((c) => c.kind)
    expect(kinds.length).toBeGreaterThanOrEqual(2)
    // Without a prior preChorus, chorus should outrank preChorus.
    expect(kinds[0]).toBe('chorus')
    expect(kinds).toContain('preChorus')
  })

  it('is sorted descending by combined score (top candidate matches predictNextSection)', () => {
    const map = build(96, [
      section('s1', 'intro', 0, 3),
      section('s2', 'verse', 4, 11),
      section('s3', 'preChorus', 12, 15),
      section('s4', 'chorus', 16, 23),
      section('s5', 'verse', 24, 31),
    ])
    const candidates = predictNextSectionCandidates(map)
    const top = predictNextSection(map)
    expect(candidates.length).toBeGreaterThan(0)
    expect(candidates[0].kind).toBe(top?.kind)
    expect(candidates[0].bars).toBe(top?.bars)
  })

  it('audio borders surface as extra length candidates for the predicted kind', () => {
    const map = build(64, [
      section('s1', 'verse', 0, 7),
      section('s2', 'chorus', 8, 15),
      section('s3', 'verse', 16, 23),
    ])
    // verse → preChorus or chorus expected; audio border at bar 30 (6 bars
    // after nextStart=24) should add a 6-bar length candidate.
    const candidates = predictNextSectionCandidates(map, {
      audioBorders: [{ bar: 30, confidence: 0.85 }],
    })
    const hasAudioCand = candidates.some(
      (c) => c.bars === 6 && c.reason.includes('audio detected'),
    )
    expect(hasAudioCand).toBe(true)
  })

  it('dedupes by (kind, bars) — no two candidates with same kind + same length', () => {
    const map = build(64, [
      section('s1', 'verse', 0, 7),
      section('s2', 'chorus', 8, 15),
    ])
    const candidates = predictNextSectionCandidates(map)
    const keys = candidates.map((c) => `${c.kind}:${c.bars}`)
    expect(new Set(keys).size).toBe(keys.length)
  })

  it('drops candidates that overrun the timeline', () => {
    // 16-bar song; last section ends at bar 14. Only 1 bar of room — no
    // candidate (chorus default 8, verse default 8, preChorus default 4)
    // can fit.
    const map = build(16, [
      section('s1', 'verse', 0, 7),
      section('s2', 'preChorus', 8, 11),
      section('s3', 'verse', 12, 14),
    ])
    expect(predictNextSectionCandidates(map)).toEqual([])
  })

  it('caps at 5 candidates max', () => {
    const map = build(128, [
      section('s1', 'verse', 0, 7),
      section('s2', 'chorus', 8, 15),
      section('s3', 'verse', 16, 23),
      section('s4', 'chorus', 24, 31),
    ])
    // After chorus, with bridge + verse + chorus + outro candidates × multiple
    // lengths, we can easily produce ≥ 6 raw candidates; ensure cap holds.
    const candidates = predictNextSectionCandidates(map, {
      audioBorders: [
        { bar: 36, confidence: 0.9 },
        { bar: 40, confidence: 0.7 },
        { bar: 44, confidence: 0.55 },
      ],
    })
    expect(candidates.length).toBeLessThanOrEqual(5)
  })
})
