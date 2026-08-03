import { describe, it, expect } from 'vitest'
import { voiceChordProgression } from './chordPlaybackVoicing'
import { NO_CHORD_SYMBOL } from '$lib/chords/noChord'
import type { ChordSymbol } from '$lib/songmap/types'

const chord = (c: Partial<ChordSymbol> & { root: ChordSymbol['root'] }): ChordSymbol => ({
  displayRaw: '',
  ...c,
})

const pcOf = (midi: number) => ((midi % 12) + 12) % 12

describe('voiceChordProgression', () => {
  it('voices N.C. / null to silence', () => {
    expect(voiceChordProgression([null, NO_CHORD_SYMBOL])).toEqual([[], []])
  })

  it('blooms a triad to more notes than a seventh (varied density)', () => {
    const [triad] = voiceChordProgression([chord({ root: 'C', quality: 'major' })])
    const [seventh] = voiceChordProgression([chord({ root: 'C', quality: '7' })])
    // triad: 3 tones → 5 upper + bass; seventh: 4 tones, no doubling → 4 + bass
    expect(triad!.length).toBeGreaterThan(seventh!.length)
    expect(triad!.length).toBe(6)
  })

  it('puts a bass note at the bottom, below the rest of the voicing', () => {
    const [notes] = voiceChordProgression([chord({ root: 'C', quality: 'major' })])
    const bass = notes![0]!
    const restLow = notes![1]!
    expect(bass).toBeLessThan(restLow)
    // Bass pitch class is the root (C = 0).
    expect(pcOf(bass)).toBe(0)
  })

  it('uses the slash bass pitch class for the bass note', () => {
    const [notes] = voiceChordProgression([chord({ root: 'C', quality: 'major', bass: 'E' })])
    expect(pcOf(notes![0]!)).toBe(4) // E
  })

  it('only sounds the chord tones (every note is a chord pitch class)', () => {
    const [notes] = voiceChordProgression([chord({ root: 'C', quality: 'major' })])
    const allowed = new Set([0, 4, 7]) // C E G
    for (const n of notes!) expect(allowed.has(pcOf(n))).toBe(true)
  })

  it('voice-leads: a I→V move stays compact instead of leaping a fifth', () => {
    const voiced = voiceChordProgression([
      chord({ root: 'C', quality: 'major' }),
      chord({ root: 'G', quality: 'major' }),
    ])
    const cUpper = voiced[0]!.slice(1) // drop bass
    const gUpper = voiced[1]!.slice(1)
    const cCenter = cUpper.reduce((a, b) => a + b, 0) / cUpper.length
    const gCenter = gUpper.reduce((a, b) => a + b, 0) / gUpper.length
    // Root-position stacks would jump ~7 semitones; voice leading keeps it tight.
    expect(Math.abs(cCenter - gCenter)).toBeLessThan(5)
  })

  it('shifts everything by an octave per octaveOffset step', () => {
    const [base] = voiceChordProgression([chord({ root: 'C', quality: 'major' })], 0)
    const [up] = voiceChordProgression([chord({ root: 'C', quality: 'major' })], 1)
    expect(up).toEqual(base!.map((n) => n + 12))
  })

  it('keeps notes within a sane MIDI range at extreme offsets', () => {
    for (const off of [-3, 3]) {
      const [notes] = voiceChordProgression([chord({ root: 'C', quality: 'major' })], off)
      for (const n of notes!) {
        expect(n).toBeGreaterThanOrEqual(28)
        expect(n).toBeLessThanOrEqual(100)
      }
    }
  })
})
