/**
 * The chords/arp parts: original time → mix time, with durations.
 *
 * The Chords tab fires these voices per frame and never needs a note LENGTH.
 * A scheduled lane does, so the length rules are the new surface area here and
 * the thing worth pinning down.
 */
import { describe, expect, it } from 'vitest'
import { buildArpPart, buildKeysPart, chordTrackLayout } from './chordMachinePart'
import { keysPoints } from './chordJamSchedule'
import { createEmptySongMap } from '$lib/songmap/factory'
import type { Bar, Beat, ChordSymbol, HarmonyEvent, SongMap } from '$lib/songmap/types'

const TRIM_START = 1

function song(opts: { chords?: (ChordSymbol['root'] | null)[]; trimEndSec?: number } = {}): SongMap {
  const roots = opts.chords ?? ['A', 'C', 'E', 'G']
  const bars: Bar[] = []
  const beats: Beat[] = []
  const harmony: HarmonyEvent[] = []
  for (let i = 0; i < roots.length; i++) {
    const start = TRIM_START + i * 2
    bars.push({
      id: `bar${i}`,
      index: i,
      startSec: start,
      endSec: start + 2,
      meter: { numerator: 4, denominator: 4 },
      beatCount: 4,
      beatIds: [0, 1, 2, 3].map((j) => `b${i}_${j}`),
    })
    for (let j = 0; j < 4; j++) {
      beats.push({ id: `b${i}_${j}`, barId: `bar${i}`, indexInBar: j, timeSec: start + j * 0.5 })
    }
    const root = roots[i]
    if (root) {
      harmony.push({
        id: `h${i}`,
        barId: `bar${i}`,
        beatId: `b${i}_0`,
        startSec: start,
        endSec: start + 2,
        chord: { root, quality: 'major', displayRaw: root },
      })
    }
  }
  return {
    ...createEmptySongMap(),
    timeline: { bars, beats },
    harmony,
    audio: {
      trim: { startSec: TRIM_START, endSec: opts.trimEndSec ?? TRIM_START + roots.length * 2 },
    } as SongMap['audio'],
  }
}

const layoutOf = (sm: SongMap) => chordTrackLayout(sm)!

describe('keys part', () => {
  it('holds each chord until the next change', () => {
    const sm = song()
    const layout = layoutOf(sm)
    const part = buildKeysPart(sm, 0, layout)
    // Four chords, one bar each — every note of a chord ends where the next starts.
    const byStart = new Map<number, number[]>()
    for (const n of part.notes) {
      byStart.set(n.atSec, [...(byStart.get(n.atSec) ?? []), n.durationSec])
    }
    const starts = [...byStart.keys()].sort((a, b) => a - b)
    expect(starts.length).toBe(4)
    for (const s of starts.slice(0, 3)) {
      // Each note lasts a full bar (2 s), not a beat.
      for (const d of byStart.get(s)!) expect(d).toBeCloseTo(2, 5)
    }
  })

  it('does NOT re-attack a chord that carries across bars', () => {
    const sm = song({ chords: ['A', 'A', 'C', 'C'] })
    const part = buildKeysPart(sm, 0, layoutOf(sm))
    const starts = [...new Set(part.notes.map((n) => n.atSec))]
    expect(starts.length).toBe(2)
    // The held A lasts two bars.
    expect(part.notes[0]!.durationSec).toBeCloseTo(4, 5)
  })

  it('shifts into mix time by the layout, not raw beat time', () => {
    const sm = song()
    const layout = layoutOf(sm)
    const part = buildKeysPart(sm, 0, layout)
    // First chord is at original 1 s, trim starts at 1 s → it lands at shiftSec.
    expect(part.notes[0]!.atSec).toBeCloseTo(layout.shiftSec, 6)
  })

  it('follows the octave setting', () => {
    const sm = song()
    const layout = layoutOf(sm)
    const low = buildKeysPart(sm, -1, layout)
    const high = buildKeysPart(sm, 1, layout)
    expect(Math.min(...high.notes.map((n) => n.midi))).toBeGreaterThan(
      Math.min(...low.notes.map((n) => n.midi)),
    )
  })

  it('plays the same notes the Chords tab voices', () => {
    // The anti-drift check: the lane must not voice chords its own way.
    const sm = song()
    const pts = keysPoints(sm, 0)
    const part = buildKeysPart(sm, 0, layoutOf(sm))
    const first = part.notes.filter((n) => n.atSec === part.notes[0]!.atSec).map((n) => n.midi)
    expect(first.sort()).toEqual([...pts[0]!.notes].sort())
  })

  it('transposes MIDI notes without changing timing or duration', () => {
    const sm = song()
    const layout = layoutOf(sm)
    const source = buildKeysPart(sm, 0, layout)
    const shifted = buildKeysPart(sm, 0, layout, 2)
    expect(shifted.notes.map((n) => n.atSec)).toEqual(source.notes.map((n) => n.atSec))
    expect(shifted.notes.map((n) => n.durationSec)).toEqual(source.notes.map((n) => n.durationSec))
    expect(shifted.notes.map((n) => n.midi)).toEqual(source.notes.map((n) => n.midi + 2))
  })

  it('clips a chord that would ring past the trim end', () => {
    const sm = song({ trimEndSec: TRIM_START + 7 })
    const layout = layoutOf(sm)
    const part = buildKeysPart(sm, 0, layout)
    const lastEnd = Math.max(...part.notes.map((n) => n.atSec + n.durationSec))
    expect(lastEnd).toBeLessThanOrEqual(layout.shiftSec + (layout.trimEndSec - TRIM_START) + 1e-6)
  })

  it('drops chords outside the trim window', () => {
    const sm = song()
    const wide = buildKeysPart(sm, 0, layoutOf(sm)).notes.length
    const narrow = buildKeysPart(sm, 0, { ...layoutOf(sm), trimEndSec: TRIM_START + 4 }).notes.length
    expect(narrow).toBeLessThan(wide)
  })

  it('a song with no chords yields no notes rather than throwing', () => {
    expect(buildKeysPart(song({ chords: [null, null] }), 0, layoutOf(song())).notes).toEqual([])
  })
})

describe('arp part', () => {
  it('gates notes short so consecutive steps re-attack', () => {
    const sm = song()
    const layout = layoutOf(sm)
    const part = buildArpPart(sm, { octave: 1, rate: '1/8', direction: 'up' }, layout)
    expect(part.notes.length).toBeGreaterThan(8)
    for (let i = 1; i < part.notes.length; i++) {
      const prev = part.notes[i - 1]!
      expect(prev.atSec + prev.durationSec).toBeLessThanOrEqual(part.notes[i]!.atSec + 1e-6)
    }
  })

  it('a faster rate yields more notes', () => {
    const sm = song()
    const layout = layoutOf(sm)
    const eighths = buildArpPart(sm, { octave: 1, rate: '1/8', direction: 'up' }, layout)
    const sixteenths = buildArpPart(sm, { octave: 1, rate: '1/16', direction: 'up' }, layout)
    expect(sixteenths.notes.length).toBeGreaterThan(eighths.notes.length)
  })

  it("'random' is stable across rebuilds — a re-schedule must not change the line", () => {
    // Live, `Math.random` is fine because nobody re-hears a note. Scheduled, a
    // fader move that re-schedules would otherwise play a different part.
    const sm = song()
    const layout = layoutOf(sm)
    const settings = { octave: 1, rate: '1/8', direction: 'random' } as const
    const a = buildArpPart(sm, settings, layout)
    const b = buildArpPart(sm, settings, layout)
    expect(a.notes.map((n) => n.midi)).toEqual(b.notes.map((n) => n.midi))
  })

  it('spans the octave RANGE the Chords tab sets', () => {
    // The Chords tab has an arp octave-RANGE knob (1-4) that the lane ignored
    // until it was threaded through — the pattern must climb further with it.
    // At 1/16 there are enough steps per chord for the figure to actually climb
    // into the upper octaves; at 1/8 it never gets that far, which is why the
    // knob only bites on faster rates.
    const sm = song()
    const layout = layoutOf(sm)
    const one = buildArpPart(sm, { octave: 1, rate: '1/16', direction: 'up', octaves: 1 }, layout)
    const three = buildArpPart(sm, { octave: 1, rate: '1/16', direction: 'up', octaves: 3 }, layout)
    const top = (p: typeof one) => Math.max(...p.notes.map((n) => n.midi))
    expect(top(three)).toBeGreaterThan(top(one))
  })

  it('applies the swing the Chords tab sets', () => {
    const sm = song()
    const layout = layoutOf(sm)
    const straight = buildArpPart(sm, { octave: 1, rate: '1/8', direction: 'up', swing: 0 }, layout)
    const swung = buildArpPart(sm, { octave: 1, rate: '1/8', direction: 'up', swing: 0.8 }, layout)
    expect(swung.notes.map((n) => n.atSec)).not.toEqual(straight.notes.map((n) => n.atSec))
    // Swing pushes OFF-beats later; the downbeats stay put.
    expect(swung.notes[0]!.atSec).toBeCloseTo(straight.notes[0]!.atSec, 6)
    expect(swung.notes[1]!.atSec).toBeGreaterThan(straight.notes[1]!.atSec)
  })

  it('defaults to one octave and no swing when unset', () => {
    const sm = song()
    const layout = layoutOf(sm)
    const bare = buildArpPart(sm, { octave: 1, rate: '1/8', direction: 'up' }, layout)
    const explicit = buildArpPart(
      sm,
      { octave: 1, rate: '1/8', direction: 'up', octaves: 1, swing: 0 },
      layout,
    )
    expect(bare.notes).toEqual(explicit.notes)
  })

  it('transposes arp MIDI notes without changing the rhythm', () => {
    const sm = song()
    const layout = layoutOf(sm)
    const source = buildArpPart(sm, { octave: 1, rate: '1/8', direction: 'up' }, layout)
    const shifted = buildArpPart(sm, { octave: 1, rate: '1/8', direction: 'up' }, layout, -1)
    expect(shifted.notes.map((n) => n.atSec)).toEqual(source.notes.map((n) => n.atSec))
    expect(shifted.notes.map((n) => n.durationSec)).toEqual(source.notes.map((n) => n.durationSec))
    expect(shifted.notes.map((n) => n.midi)).toEqual(source.notes.map((n) => n.midi - 1))
  })

  it("'up' and 'down' produce different lines", () => {
    const sm = song()
    const layout = layoutOf(sm)
    const up = buildArpPart(sm, { octave: 1, rate: '1/8', direction: 'up' }, layout)
    const down = buildArpPart(sm, { octave: 1, rate: '1/8', direction: 'down' }, layout)
    expect(up.notes.map((n) => n.midi)).not.toEqual(down.notes.map((n) => n.midi))
  })

  it('is sorted by time — the scheduler walks it in order', () => {
    const sm = song()
    const part = buildArpPart(sm, { octave: 1, rate: '1/16', direction: 'updown' }, layoutOf(sm))
    for (let i = 1; i < part.notes.length; i++) {
      expect(part.notes[i]!.atSec).toBeGreaterThanOrEqual(part.notes[i - 1]!.atSec)
    }
  })
})

describe('layout', () => {
  it('is the same one the drum and bass machines use', async () => {
    const { drumTrackLayout } = await import('./drumPart')
    expect(chordTrackLayout).toBe(drumTrackLayout)
  })

  it('is null when the song has no usable trim', () => {
    expect(chordTrackLayout({ ...song(), audio: undefined })).toBeNull()
  })
})

describe('anti-drift: the lane plays what the Chords tab plays', () => {
  // The mixer lane and the Chords tab are two DELIVERY mechanisms for one set
  // of notes. They may differ in timing precision — scheduled vs frame-driven —
  // but never in which notes, or the mixer would be playing a different part
  // from the one the player dialled in.

  it('keys: the lane holds exactly the chords the jam would fire', async () => {
    const { chordJam } = await import('./chordJam.svelte')
    const sm = song()
    chordJam.configure(sm)
    chordJam.keysOctave = 0
    const layout = layoutOf(sm)
    const part = buildKeysPart(sm, chordJam.keysOctave, layout)

    const jamPoints = chordJam.keysPointsForTest
    // Same number of chord attacks...
    const laneStarts = [...new Set(part.notes.map((n) => n.atSec))].sort((a, b) => a - b)
    expect(laneStarts.length).toBe(jamPoints.length)
    // ...at the same places, and with the same notes.
    jamPoints.forEach((p, i) => {
      expect(laneStarts[i]).toBeCloseTo(layout.shiftSec + (p.timeSec - layout.trimStartSec), 6)
      const laneNotes = part.notes.filter((n) => n.atSec === laneStarts[i]).map((n) => n.midi)
      expect(laneNotes.sort()).toEqual([...p.notes].sort())
    })
  })

  it('arp: the lane plays the jam’s line for every deterministic direction', async () => {
    const { chordJam } = await import('./chordJam.svelte')
    const sm = song()
    chordJam.configure(sm)
    const layout = layoutOf(sm)
    for (const direction of ['up', 'down', 'updown'] as const) {
      chordJam.arpOctave = 1
      chordJam.arpRate = '1/8'
      chordJam.arpDirection = direction
      const part = buildArpPart(sm, { octave: 1, rate: '1/8', direction }, layout)
      const jamHits = chordJam.arpHitsForTest
      expect(part.notes.map((n) => n.midi), direction).toEqual(jamHits.map((h) => h.midi))
      part.notes.forEach((n, i) => {
        expect(n.atSec, direction).toBeCloseTo(
          layout.shiftSec + (jamHits[i]!.timeSec - layout.trimStartSec),
          6,
        )
      })
    }
  })
})
