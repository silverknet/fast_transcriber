import { describe, expect, it } from 'vitest'
import { createEmptySongMap } from './factory'
import { generateBassGroove } from './generateBassGroove'
import { BASS_STYLES } from './bassPatterns'
import { bassMidiFor } from '$lib/audio/chordBass'
import { NO_CHORD_SYMBOL } from '$lib/chords/noChord'
import type { Bar, Beat, BassMidiEvent, ChordSymbol, HarmonyEvent, Section, SongMap } from './types'

/** `barCount` bars of 4/4, 1 s per bar → beats every 0.25 s. */
function withGrid(sm: SongMap, barCount = 4, beatsPerBar = 4): SongMap {
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

function chord(root: string, quality?: string, extra: Partial<ChordSymbol> = {}): ChordSymbol {
  return { root: root as ChordSymbol['root'], quality, displayRaw: root, ...extra }
}

function harmony(id: string, startSec: number, endSec: number, c: ChordSymbol): HarmonyEvent {
  return { id, barId: `bar${Math.floor(startSec)}`, startSec, endSec, chord: c }
}

function section(id: string, kind: Section['kind'], start: number, end: number): Section {
  return { id, kind, label: id, barRange: { startBarIndex: start, endBarIndex: end } }
}

/** One chord per bar: A minor, C major, E major, A minor. */
const song: SongMap = {
  ...withGrid(createEmptySongMap()),
  harmony: [
    harmony('h0', 0, 1, chord('A', 'minor')),
    harmony('h1', 1, 2, chord('C', 'major')),
    harmony('h2', 2, 3, chord('E', 'major')),
    harmony('h3', 3, 4, chord('A', 'minor')),
  ],
  sections: [section('v1', 'verse', 0, 1), section('c1', 'chorus', 2, 3)],
}

function inBar(events: BassMidiEvent[], i: number): BassMidiEvent[] {
  return events.filter((e) => e.timeSec >= i && e.timeSec < i + 1)
}
const pc = (midi: number) => ((midi % 12) + 12) % 12
const PC = { A: 9, C: 0, E: 4, G: 7, B: 11, D: 2, F: 5 }

describe('generateBassGroove', () => {
  it('plays the chord roots, in a real bass register', () => {
    const out = generateBassGroove(song, { style: 'roots' })
    expect(out.length).toBeGreaterThan(0)
    expect(pc(inBar(out, 0)[0]!.midi)).toBe(PC.A)
    expect(pc(inBar(out, 1)[0]!.midi)).toBe(PC.C)
    expect(pc(inBar(out, 2)[0]!.midi)).toBe(PC.E)
    // E1 (28) up to the top of the octave above it, plus room for octave leaps.
    for (const e of out) {
      expect(e.midi).toBeGreaterThanOrEqual(28)
      expect(e.midi).toBeLessThanOrEqual(28 + 24)
    }
  })

  it('sits in the SAME register as the chords view — not an octave lower', () => {
    // Regression: folding into the octave above E1 put the line ~6 semitones
    // low, where the bus high-pass eats the fundamental. It must use the
    // chords view's own placement so the two sound like one instrument.
    const sm: SongMap = {
      ...withGrid(createEmptySongMap(), 1),
      harmony: [harmony('h0', 0, 1, chord('C', 'major'))],
    }
    const out = generateBassGroove(sm, { style: 'roots' })
    expect(out[0]!.midi).toBe(bassMidiFor(PC.C))
    expect(out[0]!.midi).toBeGreaterThanOrEqual(34) // above the mud
  })

  it('a slash chord plays its bass note, not its root', () => {
    const sm: SongMap = {
      ...withGrid(createEmptySongMap(), 1),
      harmony: [harmony('h0', 0, 1, chord('C', 'major', { bass: 'E' as ChordSymbol['bass'] }))],
    }
    const out = generateBassGroove(sm, { style: 'roots' })
    expect(pc(out[0]!.midi)).toBe(PC.E)
  })

  it('takes the third from the chord quality — minor chords get a minor third', () => {
    const minor: SongMap = {
      ...withGrid(createEmptySongMap(), 1),
      harmony: [harmony('h0', 0, 1, chord('A', 'minor'))],
    }
    const major: SongMap = {
      ...withGrid(createEmptySongMap(), 1),
      harmony: [harmony('h0', 0, 1, chord('A', 'major'))],
    }
    // 'base' walking hits the third on beat 2.
    const spec = { style: 'walking' as const, complexity: 0.5 }
    const thirdOf = (sm: SongMap) =>
      generateBassGroove(sm, spec).find((e) => Math.abs(e.timeSec - 0.25) < 1e-6)!.midi
    expect(pc(thirdOf(minor))).toBe(PC.C) // A + minor 3rd
    expect(pc(thirdOf(major))).toBe(PC.C + 1) // A + major 3rd = C#
  })

  it('the fifth is the chord fifth', () => {
    const sm: SongMap = {
      ...withGrid(createEmptySongMap(), 1),
      harmony: [harmony('h0', 0, 1, chord('C', 'major'))],
    }
    // rootFifth/light: root on 1, fifth on 3.
    const out = generateBassGroove(sm, { style: 'rootFifth', complexity: 0.1 })
    const fifth = out.find((e) => Math.abs(e.timeSec - 0.5) < 1e-6)!
    expect(pc(fifth.midi)).toBe(PC.G)
  })

  it('octave steps land exactly 12 semitones above the root', () => {
    const sm: SongMap = {
      ...withGrid(createEmptySongMap(), 1),
      harmony: [harmony('h0', 0, 1, chord('C', 'major'))],
    }
    const out = generateBassGroove(sm, { style: 'octaves', complexity: 0.1 })
    expect(out[1]!.midi - out[0]!.midi).toBe(12)
  })

  it('re-attacks when a chord changes mid-bar', () => {
    const sm: SongMap = {
      ...withGrid(createEmptySongMap(), 1),
      harmony: [
        harmony('h0', 0, 0.5, chord('C', 'major')),
        harmony('h1', 0.5, 1, chord('G', 'major')),
      ],
    }
    // Roots/light would only play beat 1 — the mid-bar change must add its own.
    const out = generateBassGroove(sm, { style: 'roots', complexity: 0.1 })
    expect(out.length).toBe(2)
    expect(pc(out[0]!.midi)).toBe(PC.C)
    expect(out[1]!.timeSec).toBeCloseTo(0.5, 6)
    expect(pc(out[1]!.midi)).toBe(PC.G)
  })

  it('never rings a note over the next chord', () => {
    const sm: SongMap = {
      ...withGrid(createEmptySongMap(), 1),
      harmony: [
        harmony('h0', 0, 0.5, chord('C', 'major')),
        harmony('h1', 0.5, 1, chord('G', 'major')),
      ],
    }
    const out = generateBassGroove(sm, { style: 'roots', complexity: 0.1 })
    const first = out[0]!
    expect(first.timeSec + first.durationSec).toBeLessThanOrEqual(0.5)
  })

  it('a pedal deliberately ignores chord changes', () => {
    const sm: SongMap = {
      ...withGrid(createEmptySongMap(), 1),
      harmony: [
        harmony('h0', 0, 0.5, chord('C', 'major')),
        harmony('h1', 0.5, 1, chord('G', 'major')),
      ],
    }
    const out = generateBassGroove(sm, { style: 'pedal' })
    expect(out.length).toBe(1)
    expect(pc(out[0]!.midi)).toBe(PC.C)
    // It holds through the change rather than stopping at it.
    expect(out[0]!.durationSec).toBeGreaterThan(0.5)
  })

  it('stays silent through an N.C. instead of guessing a note', () => {
    const sm: SongMap = {
      ...withGrid(createEmptySongMap(), 2),
      harmony: [
        harmony('h0', 0, 1, chord('C', 'major')),
        harmony('h1', 1, 2, { ...NO_CHORD_SYMBOL }),
      ],
    }
    const out = generateBassGroove(sm, { style: 'roots' })
    expect(inBar(out, 0).length).toBeGreaterThan(0)
    expect(inBar(out, 1)).toEqual([])
  })

  it('produces nothing when the song has no chords yet', () => {
    expect(generateBassGroove(withGrid(createEmptySongMap()), { style: 'roots' })).toEqual([])
  })

  it('follows the section arrangement — a chorus is busier than a verse', () => {
    const out = generateBassGroove(song, { style: 'octaves' })
    expect(inBar(out, 2).length).toBeGreaterThan(inBar(out, 0).length)
  })

  it('applies a per-section style override without touching its neighbour', () => {
    const out = generateBassGroove(song, {
      style: 'roots',
      perSection: { c1: { style: 'eighths', complexity: 0.5 } },
    })
    expect(inBar(out, 2).length).toBeGreaterThan(inBar(out, 0).length)
  })

  it('mutes a section entirely when asked', () => {
    const out = generateBassGroove(song, { style: 'roots', perSection: { v1: { muted: true } } })
    expect(inBar(out, 0)).toEqual([])
    expect(inBar(out, 1)).toEqual([])
    expect(inBar(out, 2).length).toBeGreaterThan(0)
  })

  it('the octave control shifts the whole line by whole octaves', () => {
    const at0 = generateBassGroove(song, { style: 'roots', octave: 0 })
    const up1 = generateBassGroove(song, { style: 'roots', octave: 1 })
    expect(up1.map((e) => e.midi)).toEqual(at0.map((e) => e.midi + 12))
  })

  it('loudness scales velocity without moving a note', () => {
    const soft = generateBassGroove(song, { style: 'roots', loudness: 0 })
    const loud = generateBassGroove(song, { style: 'roots', loudness: 1 })
    expect(soft.map((e) => e.timeSec)).toEqual(loud.map((e) => e.timeSec))
    for (let i = 0; i < soft.length; i++) {
      expect(loud[i]!.velocity).toBeGreaterThan(soft[i]!.velocity)
    }
  })

  it('is deterministic — same input, identical output', () => {
    const spec = { style: 'walking' as const }
    expect(generateBassGroove(song, spec)).toEqual(generateBassGroove(song, spec))
  })

  it('emits sorted, in-range, positive-length notes for every shipped style', () => {
    for (const { id } of BASS_STYLES) {
      const out = generateBassGroove(song, { style: id })
      expect(out.length, id).toBeGreaterThan(0)
      for (let i = 1; i < out.length; i++) {
        expect(out[i]!.timeSec, id).toBeGreaterThanOrEqual(out[i - 1]!.timeSec)
      }
      for (const e of out) {
        expect(e.durationSec, id).toBeGreaterThan(0)
        expect(e.velocity, id).toBeGreaterThan(0)
        expect(e.velocity, id).toBeLessThanOrEqual(1)
        expect(Number.isInteger(e.midi), id).toBe(true)
      }
    }
  })
})
