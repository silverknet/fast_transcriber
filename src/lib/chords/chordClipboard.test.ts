import { describe, expect, it } from 'vitest'
import { parseChordClipboard, serializeChordClipboard } from './chordClipboard'
import type { ChordSymbol } from '$lib/songmap/types'

const sample: ChordSymbol = {
  root: 'F',
  accidental: 'sharp',
  quality: 'min7',
  displayRaw: 'F#m7',
}

describe('chordClipboard', () => {
  it('round-trips chords including null slots', () => {
    const row: (ChordSymbol | null)[] = [sample, null, { root: 'C', displayRaw: 'C' }]
    const text = serializeChordClipboard(row)
    expect(parseChordClipboard(text)).toEqual(row)
  })

  it('rejects foreign JSON', () => {
    expect(parseChordClipboard('{"kind":"other"}')).toBeNull()
    expect(parseChordClipboard('not json')).toBeNull()
  })
})
