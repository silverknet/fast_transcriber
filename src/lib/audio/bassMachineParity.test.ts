/**
 * The live bass track and the exported WAV must play the same line.
 *
 * Same guard as the drum one: both paths derive from `generateBassGroove` plus
 * the shared track layout, and `trimBassOverlaps` must be applied on both sides
 * or the live path gets doubled amplitude where two notes collide.
 */
import { describe, expect, it } from 'vitest'
import { bassMachinePart } from './bassMachineTrack'
import { bassTrackLayout, buildBassPart } from './bassPart'
import { generateBassGroove } from '$lib/songmap/generateBassGroove'
import { trimBassOverlaps } from './renderBassTrack'
import { createEmptySongMap } from '$lib/songmap/factory'
import type { Bar, Beat, ChordSymbol, HarmonyEvent, Section, SongMap } from '$lib/songmap/types'

function song(over: Partial<SongMap> = {}): SongMap {
  const bars: Bar[] = []
  const beats: Beat[] = []
  const harmony: HarmonyEvent[] = []
  const trimStart = 1
  const roots: ChordSymbol['root'][] = ['A', 'C', 'E', 'G']
  for (let i = 0; i < 8; i++) {
    const start = trimStart + i * 2
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
    harmony.push({
      id: `h${i}`,
      barId: `bar${i}`,
      startSec: start,
      endSec: start + 2,
      chord: { root: roots[i % roots.length]!, quality: 'major', displayRaw: 'X' },
    })
  }
  const sections: Section[] = [
    { id: 'v1', kind: 'verse', label: 'Verse', barRange: { startBarIndex: 0, endBarIndex: 3 } },
    { id: 'c1', kind: 'chorus', label: 'Chorus', barRange: { startBarIndex: 4, endBarIndex: 7 } },
  ]
  return {
    ...createEmptySongMap(),
    timeline: { bars, beats },
    harmony,
    sections,
    audio: { trim: { startSec: trimStart, endSec: trimStart + 16 } } as SongMap['audio'],
    bassMachine: { enabled: true, style: 'roots' },
    ...over,
  }
}

/** What the EXPORT path will place, in mix time. */
  function exportSideNotes(sm: SongMap, transposeSemitones = 0) {
    const layout = bassTrackLayout(sm)!
    return buildBassPart(generateBassGroove(sm, sm.bassMachine!), layout, transposeSemitones).notes
  }

describe('bass machine live/export parity', () => {
  it('the live part is exactly what the renderer would place', () => {
    const sm = song()
    const live = bassMachinePart(sm)!.notes
    const exported = exportSideNotes(sm)
    expect(live.map((n) => `${n.atSec}:${n.midi}:${n.durationSec}`)).toEqual(
      exported.map((n) => `${n.atSec}:${n.midi}:${n.durationSec}`),
    )
  })

  it('holds across every style', () => {
    for (const style of ['roots', 'rootFifth', 'octaves', 'eighths', 'walking', 'pedal'] as const) {
      const sm = song({ bassMachine: { enabled: true, style } })
      const live = bassMachinePart(sm)!.notes
      expect(live.map((n) => n.atSec), style).toEqual(exportSideNotes(sm).map((n) => n.atSec))
    }
  })

  it('holds with per-section overrides', () => {
    const sm = song({
      bassMachine: {
        enabled: true,
        style: 'roots',
        octave: 1,
        perSection: { c1: { style: 'octaves', complexity: 0.9 }, v1: { muted: true } },
      },
    })
    const live = bassMachinePart(sm)!.notes
    expect(live.map((n) => `${n.atSec}:${n.midi}`)).toEqual(
      exportSideNotes(sm).map((n) => `${n.atSec}:${n.midi}`),
    )
  })

  it('transposes live MIDI notes the same way as the render path', () => {
    const sm = song()
    const live = bassMachinePart(sm, 3)!.notes
    expect(live.map((n) => `${n.atSec}:${n.midi}:${n.durationSec}`)).toEqual(
      exportSideNotes(sm, 3).map((n) => `${n.atSec}:${n.midi}:${n.durationSec}`),
    )
  })

  it('applies the monophonic guard — the generator does not', () => {
    // Without trimBassOverlaps, colliding same-pitch notes double in amplitude
    // and you hear a bump. The renderer calls it; the live path must too.
    const sm = song({ bassMachine: { enabled: true, style: 'eighths', complexity: 1 } })
    const raw = generateBassGroove(sm, sm.bassMachine!)
    const guarded = trimBassOverlaps(raw)
    const live = bassMachinePart(sm)!.notes
    expect(live.length).toBeLessThanOrEqual(guarded.length)
    // No note may run into the next one's onset.
    for (let i = 1; i < live.length; i++) {
      expect(live[i - 1]!.atSec + live[i - 1]!.durationSec).toBeLessThanOrEqual(
        live[i]!.atSec + 1e-6,
      )
    }
  })

  it('drops the same out-of-trim notes on both sides', () => {
    const sm = song({ audio: { trim: { startSec: 6, endSec: 12 } } as SongMap['audio'] })
    const live = bassMachinePart(sm)!.notes
    expect(live.map((n) => n.atSec)).toEqual(exportSideNotes(sm).map((n) => n.atSec))
  })

  it('is null when the track is off or unplayable', () => {
    expect(bassMachinePart(song({ bassMachine: { enabled: false, style: 'roots' } }))).toBeNull()
    expect(bassMachinePart(song({ bassMachine: undefined }))).toBeNull()
    expect(bassMachinePart(song({ audio: undefined }))).toBeNull()
  })

  it('produces nothing without chords — a bass line needs harmony', () => {
    expect(bassMachinePart(song({ harmony: [] }))!.notes).toEqual([])
  })
})
