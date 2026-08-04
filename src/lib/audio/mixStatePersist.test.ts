/**
 * The other half of "the Custom 1 button is dead sometimes".
 *
 * Linking the Chords lane to Custom 1 saved fine. Then a session where the
 * lane was not built — the flag that creates it is per-browser localStorage,
 * not part of the song — rewrote `mixState.tracks` from the lanes that DID
 * exist, and the link was gone. Nothing on screen said so; the button was
 * simply dead again next time.
 */
import { describe, expect, it } from 'vitest'
import { mergePersistedTracks } from './mixStatePersist'

type Track = { key: string; volume?: number; liveSlot?: string; muted?: boolean }

describe('a session never erases a lane it did not build', () => {
  const stored: Track[] = [
    { key: 'original', volume: 1 },
    { key: 'chord-machine', volume: 0.8, liveSlot: 'custom1' },
    { key: 'arp-machine', volume: 0.6, liveSlot: 'custom2' },
  ]

  it('THE BUG: keeps the Chords link when this session has no chord lane', () => {
    // The generated lanes were off in this browser, so the engine never held
    // them — and the save used to drop them from the song for good.
    const present: Track[] = [{ key: 'original', volume: 0.9 }]
    const merged = mergePersistedTracks(present, stored)

    const chords = merged.find((t) => t.key === 'chord-machine')
    expect(chords?.liveSlot).toBe('custom1')
    expect(merged.find((t) => t.key === 'arp-machine')?.liveSlot).toBe('custom2')
  })

  it('live engine state WINS for a lane this session does hold', () => {
    // Carrying forward must never resurrect a stale value over a real one.
    const present: Track[] = [{ key: 'chord-machine', volume: 0.2, liveSlot: 'custom2' }]
    const merged = mergePersistedTracks(present, stored)

    expect(merged.filter((t) => t.key === 'chord-machine')).toHaveLength(1)
    expect(merged[0]).toEqual({ key: 'chord-machine', volume: 0.2, liveSlot: 'custom2' })
  })

  it('keeps present lanes first, in their given order — the row order is the array order', () => {
    const present: Track[] = [{ key: 'stem:drums.wav' }, { key: 'original' }]
    expect(mergePersistedTracks(present, stored).map((t) => t.key)).toEqual([
      'stem:drums.wav',
      'original',
      'chord-machine',
      'arp-machine',
    ])
  })

  it('handles a song with no saved mix state at all', () => {
    const present: Track[] = [{ key: 'original' }]
    expect(mergePersistedTracks(present, undefined)).toEqual(present)
    expect(mergePersistedTracks(present, [])).toEqual(present)
  })

  it('an empty session does not wipe the song', () => {
    // Belt and braces: if lanes somehow never registered, saving must not
    // amount to deleting every fader, EQ and link the song had.
    expect(mergePersistedTracks([], stored)).toEqual(stored)
  })
})
