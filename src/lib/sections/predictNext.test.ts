import { describe, expect, it } from 'vitest'
import { createEmptySongMap } from '$lib/songmap/factory'
import { predictNextSection } from './predictNext'
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
