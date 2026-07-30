import { describe, it, expect } from 'vitest'
import { chordVoicingMidi } from './chordVoicing'
import { NO_CHORD_SYMBOL } from './noChord'
import type { ChordSymbol } from '$lib/songmap/types'

const chord = (c: Partial<ChordSymbol> & { root: ChordSymbol['root'] }): ChordSymbol => ({
  displayRaw: '',
  ...c,
})

describe('chordVoicingMidi', () => {
  it('voices a major triad around middle C', () => {
    expect(chordVoicingMidi(chord({ root: 'C', quality: 'major' }))).toEqual([60, 64, 67])
  })

  it('voices a minor triad from its root pitch class', () => {
    // A = pitch class 9 → 69, 72, 76
    expect(chordVoicingMidi(chord({ root: 'A', quality: 'minor' }))).toEqual([69, 72, 76])
  })

  it('adds the seventh for a dominant 7', () => {
    // G = pitch class 7 → 67 + [0,4,7,10]
    expect(chordVoicingMidi(chord({ root: 'G', quality: '7' }))).toEqual([67, 71, 74, 77])
  })

  it('adds an upper extension tone', () => {
    // Cadd9: [0,4,7] + 14
    expect(chordVoicingMidi(chord({ root: 'C', quality: 'add9' }))).toEqual([60, 64, 67, 74])
  })

  it('moves the fifth for a b5 alteration', () => {
    expect(chordVoicingMidi(chord({ root: 'C', quality: 'major', alterations: ['b5'] }))).toEqual([
      60, 64, 66,
    ])
  })

  it('voices a slash bass an octave below the chord root', () => {
    // C/E: bass E (pc 4) → 52, then C major
    expect(chordVoicingMidi(chord({ root: 'C', quality: 'major', bass: 'E' }))).toEqual([
      52, 60, 64, 67,
    ])
  })

  it('falls back to a major triad for an unknown quality', () => {
    expect(chordVoicingMidi(chord({ root: 'C', quality: 'weird9b13sus' }))).toEqual([60, 64, 67])
  })

  it('voices N.C. to nothing', () => {
    expect(chordVoicingMidi(NO_CHORD_SYMBOL)).toEqual([])
  })
})
