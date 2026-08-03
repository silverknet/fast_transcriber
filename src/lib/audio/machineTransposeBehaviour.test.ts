/**
 * What each machine ACTUALLY plays when the song is transposed.
 *
 * Behavioural, not a source grep: these compare real note numbers coming out of
 * the part builders. The rule under test —
 *
 *   pitched machines move their NOTES; drums move nothing.
 *
 * Also covers the ordering that is easy to get wrong: transpose FIRST, then add
 * a machine. A lane built after the fact must come out already transposed,
 * because nothing re-transposes it afterwards.
 */
import { describe, expect, it } from 'vitest'
import { bassMachinePart } from './bassMachineTrack'
import { chordMachinePart } from './chordMachineTrack'
import { drumMachinePart } from './drumMachineTrack'
import { createEmptySongMap } from '$lib/songmap/factory'
import type { Bar, Beat, ChordSymbol, HarmonyEvent, Section, SongMap } from '$lib/songmap/types'

const TRIM_START = 1

function song(over: Partial<SongMap> = {}): SongMap {
  const roots: ChordSymbol['root'][] = ['A', 'C', 'E', 'G']
  const bars: Bar[] = []
  const beats: Beat[] = []
  const harmony: HarmonyEvent[] = []
  for (let i = 0; i < 8; i++) {
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
    harmony.push({
      id: `h${i}`,
      barId: `bar${i}`,
      beatId: `b${i}_0`, // harmony is keyed by BEAT; barId alone resolves to nothing
      startSec: start,
      endSec: start + 2,
      chord: { root: roots[i % roots.length]!, quality: 'major', displayRaw: 'X' },
    })
  }
  const sections: Section[] = [
    { id: 'v1', kind: 'verse', label: 'Verse', barRange: { startBarIndex: 0, endBarIndex: 7 } },
  ]
  return {
    ...createEmptySongMap(),
    timeline: { bars, beats },
    harmony,
    sections,
    audio: { trim: { startSec: TRIM_START, endSec: TRIM_START + 16 } } as SongMap['audio'],
    bassMachine: { enabled: true, style: 'roots' },
    drumMachine: { enabled: true, style: 'rock' },
    ...over,
  }
}

describe('bass machine', () => {
  it('plays LOWER notes when the song is transposed down', () => {
    const sm = song()
    const plain = bassMachinePart(sm, 0)!.notes
    const down = bassMachinePart(sm, -2)!.notes
    expect(plain.length).toBeGreaterThan(0)
    expect(down.length).toBe(plain.length)
    down.forEach((n, i) => expect(n.midi).toBe(plain[i]!.midi - 2))
  })

  it('plays higher notes when transposed up', () => {
    const sm = song()
    const plain = bassMachinePart(sm, 0)!.notes
    const up = bassMachinePart(sm, 5)!.notes
    up.forEach((n, i) => expect(n.midi).toBe(plain[i]!.midi + 5))
  })

  it('does not move the notes in TIME — only in pitch', () => {
    const sm = song()
    const plain = bassMachinePart(sm, 0)!.notes
    const down = bassMachinePart(sm, -4)!.notes
    down.forEach((n, i) => {
      expect(n.atSec).toBeCloseTo(plain[i]!.atSec, 9)
      expect(n.durationSec).toBeCloseTo(plain[i]!.durationSec, 9)
    })
  })
})

describe('chord + arp machines', () => {
  for (const voice of ['keys', 'arp'] as const) {
    it(`${voice}: notes move with the transpose`, () => {
      const sm = song()
      const plain = chordMachinePart(sm, voice, 0)!.notes
      const down = chordMachinePart(sm, voice, -3)!.notes
      expect(plain.length).toBeGreaterThan(0)
      expect(down.length).toBe(plain.length)
      down.forEach((n, i) => expect(n.midi).toBe(plain[i]!.midi - 3))
    })
  }
})

describe('drum machine', () => {
  it('ignores a transpose even if one is forced in', () => {
    // Deliberately behavioural rather than a signature check: `Function.length`
    // does NOT count defaulted parameters, so `(sm, semis = 0)` still reports 1
    // and a signature assertion passes while the transpose is live. Force a
    // value through and prove the hits are byte-identical.
    const sm = song()
    const a = drumMachinePart(sm)!
    const b = (drumMachinePart as (sm: SongMap, semis?: number) => typeof a)(sm, -5)!
    expect(a.hits.map((h) => `${h.mixTimeSec}:${h.cls}:${h.gain}`)).toEqual(
      b.hits.map((h) => `${h.mixTimeSec}:${h.cls}:${h.gain}`),
    )
    expect(a.hits.length).toBeGreaterThan(0)
  })

  it('carries no pitch information that COULD be transposed', () => {
    // A drum hit is a voice class + a gain. There is no note number, so a
    // transpose has nothing to act on even if someone wired one in.
    const hit = drumMachinePart(song())!.hits[0]!
    expect(hit).not.toHaveProperty('midi')
    expect(hit).toHaveProperty('cls')
  })
})

describe('ordering: transpose first, THEN add the machine', () => {
  it('a bass machine added while transposed comes out already transposed', () => {
    // The mixer rebuilds its plan on add, reading the CURRENT transpose — so a
    // lane created after the fact must be built transposed, since nothing goes
    // back and transposes it later.
    const before = song({ bassMachine: undefined })
    expect(bassMachinePart(before, -2)).toBeNull() // no machine yet

    const after = song() // the machine now exists
    const added = bassMachinePart(after, -2)!.notes
    const untransposed = bassMachinePart(after, 0)!.notes
    added.forEach((n, i) => expect(n.midi).toBe(untransposed[i]!.midi - 2))
  })

  it('a chord machine added while transposed comes out already transposed', () => {
    const sm = song()
    const added = chordMachinePart(sm, 'keys', 4)!.notes
    const plain = chordMachinePart(sm, 'keys', 0)!.notes
    added.forEach((n, i) => expect(n.midi).toBe(plain[i]!.midi + 4))
  })

  it('changing the transpose again re-derives from the ORIGINAL, never compounds', () => {
    // Parts are rebuilt from the song each time, so going -2 then -3 must land
    // on -3 — not -5. Compounding is the classic transpose bug.
    const sm = song()
    const plain = bassMachinePart(sm, 0)!.notes
    const twoDown = bassMachinePart(sm, -2)!.notes
    const threeDown = bassMachinePart(sm, -3)!.notes
    threeDown.forEach((n, i) => expect(n.midi).toBe(plain[i]!.midi - 3))
    expect(twoDown[0]!.midi).toBe(plain[0]!.midi - 2)
  })

  it('returning to 0 restores the original notes exactly', () => {
    const sm = song()
    const plain = bassMachinePart(sm, 0)!.notes
    bassMachinePart(sm, -5)
    const back = bassMachinePart(sm, 0)!.notes
    expect(back.map((n) => n.midi)).toEqual(plain.map((n) => n.midi))
  })
})
