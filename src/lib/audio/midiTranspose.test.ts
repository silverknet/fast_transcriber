import { describe, expect, it } from 'vitest'
import { transposeMidiNote } from './midiTranspose'

describe('transposeMidiNote', () => {
  it('moves MIDI notes by semitones', () => {
    expect(transposeMidiNote(60, 2)).toBe(62)
    expect(transposeMidiNote(60, -3)).toBe(57)
  })

  it('clamps to the MIDI note range and shared transpose range', () => {
    expect(transposeMidiNote(2, -12)).toBe(0)
    expect(transposeMidiNote(125, 12)).toBe(127)
    expect(transposeMidiNote(60, 30)).toBe(72)
  })
})
