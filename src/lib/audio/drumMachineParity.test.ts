/**
 * The live drum track and the exported WAV must play the same part.
 *
 * They are now two code paths: `createDrumMachineInstrument` schedules notes,
 * `renderDrumMachineWavBlob` renders samples. They stay honest only because
 * both derive from the SAME two calls — `generateDrumGroove(sm, sm.drumMachine)`
 * for the notes and `drumTrackLayout(sm)` for where those notes sit.
 *
 * If someone later "optimises" one side — a different quantize, a nudge, an
 * extra fill — nothing else in the suite would notice. This is the test that
 * would.
 */
import { describe, expect, it } from 'vitest'
import { drumMachinePart } from './drumMachineTrack'
import { buildDrumPart, drumTrackLayout } from './drumPart'
import { generateDrumGroove } from '$lib/songmap/generateDrumGroove'
import { drumVelocityGain } from './renderDrumTrack'
import { createEmptySongMap } from '$lib/songmap/factory'
import type { Bar, Beat, Section, SongMap } from '$lib/songmap/types'

function song(over: Partial<SongMap> = {}): SongMap {
  const bars: Bar[] = []
  const beats: Beat[] = []
  const trimStart = 1.5
  for (let i = 0; i < 16; i++) {
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
  }
  const sections: Section[] = [
    { id: 'v1', kind: 'verse', label: 'Verse', barRange: { startBarIndex: 0, endBarIndex: 7 } },
    { id: 'c1', kind: 'chorus', label: 'Chorus', barRange: { startBarIndex: 8, endBarIndex: 15 } },
  ]
  return {
    ...createEmptySongMap(),
    timeline: { bars, beats },
    sections,
    audio: { trim: { startSec: trimStart, endSec: trimStart + 32 } } as SongMap['audio'],
    drumMachine: { enabled: true, style: 'rock' },
    ...over,
  }
}

/** What the EXPORT path will place, expressed in mix time. */
function exportSideHits(sm: SongMap) {
  const layout = drumTrackLayout(sm)!
  const events = generateDrumGroove(sm, sm.drumMachine!)
  return buildDrumPart(events, layout).hits
}

describe('drum machine live/export parity', () => {
  it('the live part is exactly what the renderer would place', () => {
    const sm = song()
    const live = drumMachinePart(sm)!.hits
    const exported = exportSideHits(sm)
    expect(live.length).toBe(exported.length)
    expect(live.map((h) => h.mixTimeSec)).toEqual(exported.map((h) => h.mixTimeSec))
    expect(live.map((h) => h.cls)).toEqual(exported.map((h) => h.cls))
    expect(live.map((h) => h.gain)).toEqual(exported.map((h) => h.gain))
  })

  it('holds across every style', () => {
    for (const style of ['rock', 'pop', 'funk', 'disco', 'ballad', 'halfTime'] as const) {
      const sm = song({ drumMachine: { enabled: true, style } })
      const live = drumMachinePart(sm)!.hits
      const exported = exportSideHits(sm)
      expect(live.map((h) => h.mixTimeSec), style).toEqual(exported.map((h) => h.mixTimeSec))
    }
  })

  it('holds with per-section overrides, where drift would be easiest to miss', () => {
    const sm = song({
      drumMachine: {
        enabled: true,
        style: 'rock',
        complexity: 0.9,
        fills: 1,
        pulse: 'ride',
        voices: { cymbal: false },
        perSection: { c1: { style: 'disco', loudness: 0.9 }, v1: { complexity: 0.2 } },
      },
    })
    const live = drumMachinePart(sm)!.hits
    const exported = exportSideHits(sm)
    expect(live.length).toBeGreaterThan(0)
    expect(live.map((h) => `${h.mixTimeSec}:${h.cls}:${h.gain}`)).toEqual(
      exported.map((h) => `${h.mixTimeSec}:${h.cls}:${h.gain}`),
    )
  })

  it('both sides drop the same out-of-trim events', () => {
    // A short trim in the middle of the grid: everything outside it must be
    // dropped identically, or one path plays hits the other doesn't.
    const sm = song({ audio: { trim: { startSec: 6, endSec: 14 } } as SongMap['audio'] })
    const live = drumMachinePart(sm)!.hits
    const exported = exportSideHits(sm)
    expect(live.map((h) => h.mixTimeSec)).toEqual(exported.map((h) => h.mixTimeSec))
    const raw = generateDrumGroove(sm, sm.drumMachine!)
    expect(live.length).toBeLessThan(raw.length) // something really was dropped
  })

  it('velocities go through the renderer’s curve on the live side too', () => {
    const sm = song()
    const layout = drumTrackLayout(sm)!
    const raw = generateDrumGroove(sm, sm.drumMachine!).filter(
      (e) => e.timeSec >= layout.trimStartSec && e.timeSec < layout.trimEndSec,
    )
    const live = drumMachinePart(sm)!.hits
    expect(live[0]!.gain).toBeCloseTo(drumVelocityGain(raw[0]!.velocity), 12)
  })

  it('is null when the track is off, so no lane is built', () => {
    expect(drumMachinePart(song({ drumMachine: { enabled: false, style: 'rock' } }))).toBeNull()
    expect(drumMachinePart(song({ drumMachine: undefined }))).toBeNull()
  })

  it('is null without a usable trim — the same gate the renderer throws on', () => {
    expect(drumMachinePart(song({ audio: undefined }))).toBeNull()
  })
})
