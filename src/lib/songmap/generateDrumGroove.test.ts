import { describe, expect, it } from 'vitest'
import { createEmptySongMap } from './factory'
import { generateDrumGroove } from './generateDrumGroove'
import { DRUM_STYLES, drumStyle, complexityForKind, intensityForComplexity } from './drumPatterns'
import type { Bar, Beat, DrumClass, DrumMidiEvent, Section, SongMap } from './types'

/** `barCount` bars of 4/4, 1 s per bar → beats every 0.25 s, 16th slots every 0.0625 s. */
function withGrid(sm: SongMap, barCount = 8, beatsPerBar = 4): SongMap {
  const bars: Bar[] = []
  const beats: Beat[] = []
  for (let i = 0; i < barCount; i++) {
    bars.push({
      id: `bar${i}`,
      index: i,
      startSec: i,
      endSec: i + 1,
      meter: { numerator: beatsPerBar, denominator: 4 },
      beatCount: beatsPerBar,
      beatIds: Array.from({ length: beatsPerBar }, (_, j) => `b${i}_${j}`),
    })
    for (let j = 0; j < beatsPerBar; j++) {
      beats.push({ id: `b${i}_${j}`, barId: `bar${i}`, indexInBar: j, timeSec: i + j / beatsPerBar })
    }
  }
  return { ...sm, timeline: { bars, beats } }
}

function section(id: string, kind: Section['kind'], start: number, end: number): Section {
  return { id, kind, label: id, barRange: { startBarIndex: start, endBarIndex: end } }
}

/** Events inside bar `i` (bars are 1 s long starting at 0). */
function inBar(events: DrumMidiEvent[], i: number): DrumMidiEvent[] {
  return events.filter((e) => e.timeSec >= i && e.timeSec < i + 1)
}

function slotsOf(events: DrumMidiEvent[], bar: number, cls: DrumClass): number[] {
  return inBar(events, bar)
    .filter((e) => e.cls === cls)
    .map((e) => Math.round((e.timeSec - bar) * 16))
    .sort((a, b) => a - b)
}

const base = withGrid(createEmptySongMap())
const twoSections: SongMap = {
  ...base,
  sections: [section('verse1', 'verse', 0, 3), section('chorus1', 'chorus', 4, 7)],
}

describe('generateDrumGroove', () => {
  it('needs no detected events — it generates from timeline + sections alone', () => {
    const out = generateDrumGroove(twoSections, { style: 'rock' })
    expect(out.length).toBeGreaterThan(0)
    // Nothing in the SongMap carried drum audio.
    expect(twoSections.drumMidi).toBeUndefined()
  })

  it('lays the style pattern down on every non-fill bar', () => {
    const out = generateDrumGroove(twoSections, {
      style: 'rock',
      fills: 0,
      crashOnSectionStart: false,
    })
    // A verse's default complexity lands in the 'base' tier.
    expect(intensityForComplexity(complexityForKind('verse'))).toBe('base')
    const expected = drumStyle('rock').bars.base
    for (const bar of [0, 1, 2]) {
      expect(slotsOf(out, bar, 'kick')).toEqual(expected.kick!.map((s) => s.slot).sort((a, b) => a - b))
      expect(slotsOf(out, bar, 'snare')).toEqual([4, 12])
    }
  })

  it('picks intensity from section kind — a chorus is busier than a verse', () => {
    const out = generateDrumGroove(twoSections, { style: 'rock', fills: 0 })
    const verseHats = slotsOf(out, 0, 'hihat').length
    const chorusHats = slotsOf(out, 4, 'hihat').length
    expect(chorusHats).toBeGreaterThan(verseHats)
  })

  it('replaces the last bar of a section with a fill, and only that bar', () => {
    const withoutFills = generateDrumGroove(twoSections, { style: 'rock', fills: 0 })
    const withFills = generateDrumGroove(twoSections, { style: 'rock', fills: 1 })

    // Bar 3 is the verse's last bar and something follows it → fill.
    expect(slotsOf(withFills, 3, 'tom').length).toBeGreaterThan(0)
    expect(slotsOf(withoutFills, 3, 'tom')).toEqual([])
    // Earlier bars in the same section are untouched.
    expect(slotsOf(withFills, 1, 'snare')).toEqual(slotsOf(withoutFills, 1, 'snare'))
  })

  it('keeps the groove running into the fill instead of dropping the whole bar', () => {
    const out = generateDrumGroove(twoSections, { style: 'rock', fills: 1 })
    // The fill starts in the back half, so beat 1 still has its kick.
    expect(slotsOf(out, 3, 'kick')).toContain(0)
  })

  it('does not fill the final bar of the song — there is nothing to lead into', () => {
    const out = generateDrumGroove(twoSections, { style: 'rock', fills: 1 })
    expect(slotsOf(out, 7, 'tom')).toEqual([])
  })

  it('does not fill a one-bar section — the fill would erase it', () => {
    const sm: SongMap = {
      ...base,
      sections: [section('stab', 'break', 0, 0), section('verse1', 'verse', 1, 7)],
    }
    const out = generateDrumGroove(sm, { style: 'rock', fills: 1 })
    expect(slotsOf(out, 0, 'tom')).toEqual([])
  })

  it('crashes on each section downbeat', () => {
    const out = generateDrumGroove(twoSections, { style: 'rock', crashOnSectionStart: true })
    expect(slotsOf(out, 0, 'cymbal')).toContain(0)
    expect(slotsOf(out, 4, 'cymbal')).toContain(0)
    expect(slotsOf(out, 5, 'cymbal')).not.toContain(0)
  })

  it('maps a shared boundary bar to the next section instead of double-playing it', () => {
    const overlappedBoundary: SongMap = {
      ...base,
      sections: [section('verse1', 'verse', 0, 4), section('chorus1', 'chorus', 4, 7)],
    }
    const out = generateDrumGroove(overlappedBoundary, {
      style: 'rock',
      fills: 1,
      crashOnSectionStart: true,
      perSection: { chorus1: { style: 'disco', complexity: 0.85 } },
    })

    // The verse fill leads into bar 4; it does not land on top of the chorus.
    expect(slotsOf(out, 3, 'tom').length).toBeGreaterThan(0)
    expect(slotsOf(out, 4, 'tom')).toEqual([])
    // Bar 4 is the chorus downbeat: one crash and the chorus-only disco kick pattern.
    expect(slotsOf(out, 4, 'cymbal')).toEqual([0])
    expect(slotsOf(out, 4, 'kick')).toEqual([0, 4, 8, 12])
  })

  it('uses Bar.index for section ranges instead of assuming array offsets', () => {
    const shiftedIndexes: SongMap = {
      ...base,
      timeline: {
        ...base.timeline,
        bars: base.timeline.bars.map((bar) => ({ ...bar, index: bar.index + 10 })),
      },
      sections: [section('verse1', 'verse', 10, 13), section('chorus1', 'chorus', 14, 17)],
    }
    const out = generateDrumGroove(shiftedIndexes, {
      style: 'rock',
      fills: 1,
      crashOnSectionStart: true,
      perSection: { chorus1: { style: 'disco', complexity: 0.85 } },
    })

    expect(slotsOf(out, 3, 'tom').length).toBeGreaterThan(0)
    expect(slotsOf(out, 4, 'cymbal')).toEqual([0])
    expect(slotsOf(out, 4, 'kick')).toEqual([0, 4, 8, 12])
  })

  it('applies a per-section style override without touching other sections', () => {
    const out = generateDrumGroove(twoSections, {
      style: 'rock',
      fills: 0,
      crashOnSectionStart: false,
      perSection: { chorus1: { style: 'disco' } },
    })
    // Four-on-the-floor: a kick on every beat.
    expect(slotsOf(out, 4, 'kick')).toEqual([0, 4, 8, 12])
    // The verse kept plain rock.
    expect(slotsOf(out, 0, 'kick')).toEqual([0, 8])
  })

  it('applies a per-section complexity override', () => {
    const out = generateDrumGroove(twoSections, {
      style: 'rock',
      fills: 0,
      perSection: { verse1: { complexity: 0.1 } },
    })
    expect(slotsOf(out, 0, 'hihat')).toEqual([0, 4, 8, 12]) // quarters = light
  })

  it('mutes a section entirely when asked', () => {
    const out = generateDrumGroove(twoSections, {
      style: 'rock',
      perSection: { verse1: { muted: true } },
    })
    for (const bar of [0, 1, 2, 3]) expect(inBar(out, bar)).toEqual([])
    expect(inBar(out, 4).length).toBeGreaterThan(0)
  })

  it('loudness scales velocities without moving any hit', () => {
    const soft = generateDrumGroove(twoSections, { style: 'rock', loudness: 0 })
    const loud = generateDrumGroove(twoSections, { style: 'rock', loudness: 1 })
    expect(soft.map((e) => e.timeSec)).toEqual(loud.map((e) => e.timeSec))
    for (let i = 0; i < soft.length; i++) {
      expect(loud[i]!.velocity).toBeGreaterThan(soft[i]!.velocity)
      expect(loud[i]!.velocity).toBeLessThanOrEqual(1)
    }
  })

  it('a song-wide complexity overrides the per-kind arrangement default', () => {
    // Without it, chorus (0.85) is busier than verse (0.5); pinned, they match.
    const pinned = generateDrumGroove(twoSections, {
      style: 'rock',
      complexity: 0.5,
      fills: 0,
      crashOnSectionStart: false,
    })
    expect(slotsOf(pinned, 0, 'hihat')).toEqual(slotsOf(pinned, 4, 'hihat'))
  })

  it('the fills knob at 0 removes fills, and higher values fill busier', () => {
    const none = generateDrumGroove(twoSections, { style: 'rock', fills: 0 })
    const some = generateDrumGroove(twoSections, { style: 'rock', fills: 1 })
    expect(slotsOf(none, 3, 'tom')).toEqual([])
    expect(slotsOf(some, 3, 'tom').length).toBeGreaterThan(0)
  })

  it('a ride-driven groove moves the pulse off the hats, same slots', () => {
    const hats = generateDrumGroove(twoSections, { style: 'rock', fills: 0, pulse: 'hihat' })
    const ride = generateDrumGroove(twoSections, { style: 'rock', fills: 0, pulse: 'ride' })
    expect(slotsOf(ride, 0, 'hihat')).toEqual([])
    expect(slotsOf(ride, 0, 'ride')).toEqual(slotsOf(hats, 0, 'hihat'))
    // Kick and snare are untouched by the pulse choice.
    expect(slotsOf(ride, 0, 'kick')).toEqual(slotsOf(hats, 0, 'kick'))
  })

  it('pulse "none" strips the pulse layer entirely, leaving kick and snare', () => {
    const out = generateDrumGroove(twoSections, { style: 'rock', fills: 0, pulse: 'none' })
    expect(slotsOf(out, 0, 'hihat')).toEqual([])
    expect(slotsOf(out, 0, 'ride')).toEqual([])
    expect(slotsOf(out, 0, 'kick').length).toBeGreaterThan(0)
    expect(slotsOf(out, 0, 'snare')).toEqual([4, 12])
  })

  it('switching a kit piece off silences it everywhere', () => {
    const out = generateDrumGroove(twoSections, {
      style: 'rock',
      fills: 0,
      voices: { snare: false },
    })
    for (const bar of [0, 1, 4, 5]) expect(slotsOf(out, bar, 'snare')).toEqual([])
    expect(slotsOf(out, 0, 'kick').length).toBeGreaterThan(0)
  })

  it('switching the crash off also stops the section-start crash', () => {
    const out = generateDrumGroove(twoSections, {
      style: 'rock',
      crashOnSectionStart: true,
      voices: { cymbal: false },
    })
    expect(out.filter((e) => e.cls === 'cymbal')).toEqual([])
  })

  it('switching the ride off silences a ride-driven groove, not just the hats', () => {
    const out = generateDrumGroove(twoSections, {
      style: 'rock',
      fills: 0,
      pulse: 'ride',
      voices: { ride: false },
    })
    expect(slotsOf(out, 0, 'ride')).toEqual([])
    expect(slotsOf(out, 0, 'hihat')).toEqual([])
  })

  it('a section can drive on the ride while the rest of the song uses hats', () => {
    const out = generateDrumGroove(twoSections, {
      style: 'rock',
      fills: 0,
      perSection: { chorus1: { pulse: 'ride' } },
    })
    expect(slotsOf(out, 4, 'ride').length).toBeGreaterThan(0)
    expect(slotsOf(out, 0, 'ride')).toEqual([])
    expect(slotsOf(out, 0, 'hihat').length).toBeGreaterThan(0)
  })

  it('fills build toward the section change instead of sitting flat', () => {
    const out = generateDrumGroove(twoSections, { style: 'rock', fills: 1, loudness: 0.5 })
    // Bar 3 is the verse's fill bar; toms carry its back half.
    const toms = inBar(out, 3)
      .filter((e) => e.cls === 'tom')
      .sort((a, b) => a.timeSec - b.timeSec)
    expect(toms.length).toBeGreaterThan(1)
    expect(toms.at(-1)!.velocity).toBeGreaterThan(toms[0]!.velocity)
  })

  it('fill snares use accent-and-ghost levels, not one flat velocity', () => {
    const out = generateDrumGroove(twoSections, { style: 'rock', fills: 1, complexity: 0.9 })
    const snares = inBar(out, 3).filter((e) => e.cls === 'snare')
    expect(snares.length).toBeGreaterThan(2)
    const vels = snares.map((e) => e.velocity)
    // A real fill has dynamic range across its snares; a typed one doesn't.
    expect(Math.max(...vels) - Math.min(...vels)).toBeGreaterThan(0.2)
  })

  it('keeps fill velocities inside range even at full loudness', () => {
    const out = generateDrumGroove(twoSections, { style: 'rock', fills: 1, loudness: 1 })
    for (const e of out) {
      expect(e.velocity).toBeGreaterThan(0)
      expect(e.velocity).toBeLessThanOrEqual(1)
    }
  })

  it('is deterministic — same input, identical output', () => {
    const spec = { style: 'funk' as const, perSection: { chorus1: { complexity: 0.9 } } }
    expect(generateDrumGroove(twoSections, spec)).toEqual(generateDrumGroove(twoSections, spec))
  })

  it('drops slots that do not exist in a short bar instead of misplacing them', () => {
    // 3/4 over a 1 s bar → 12 slots, one every 1/12 s. Rock/base authors a
    // snare on 4 and 12 and 8th hats through 14; everything from slot 12 up
    // has nowhere to go and must be dropped, NOT wrapped or squeezed in.
    const sm = withGrid(createEmptySongMap(), 4, 3)
    const out = generateDrumGroove({ ...sm, sections: [section('v', 'verse', 0, 3)] }, {
      style: 'rock',
      fills: 0,
      crashOnSectionStart: false,
    })
    const slotAt = (e: DrumMidiEvent) => Math.round((e.timeSec - Math.floor(e.timeSec)) * 12)
    const firstBar = out.filter((e) => e.timeSec < 1)
    expect(firstBar.filter((e) => e.cls === 'snare').map(slotAt)).toEqual([4])
    expect(
      firstBar
        .filter((e) => e.cls === 'hihat')
        .map(slotAt)
        .sort((a, b) => a - b),
    ).toEqual([0, 2, 4, 6, 8, 10])
    for (const e of out) expect(slotAt(e)).toBeLessThan(12)
  })

  it('still grooves on a song with no sections at all', () => {
    const out = generateDrumGroove(base, { style: 'pop' })
    expect(out.length).toBeGreaterThan(0)
  })

  it('emits sorted, in-range events for every shipped style', () => {
    for (const { id } of DRUM_STYLES) {
      const out = generateDrumGroove(twoSections, { style: id })
      expect(out.length, id).toBeGreaterThan(0)
      for (let i = 1; i < out.length; i++) {
        expect(out[i]!.timeSec, id).toBeGreaterThanOrEqual(out[i - 1]!.timeSec)
      }
      for (const e of out) {
        expect(e.velocity, id).toBeGreaterThan(0)
        expect(e.velocity, id).toBeLessThanOrEqual(1)
        expect(Number.isFinite(e.timeSec), id).toBe(true)
      }
    }
  })
})
