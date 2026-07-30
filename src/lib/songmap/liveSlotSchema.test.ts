import { describe, expect, it } from 'vitest'
import { createEmptySongMap } from './factory'
import { parseSongMap } from './parse'
import { validateSongMap } from './validate'
import type { MixTrackState, SongMap } from './types'

/**
 * The live-button link lives in `mixState`, so it has to survive the .smap
 * round-trip — a link that silently vanishes on reload is the same as no
 * feature at all.
 */
function withMix(tracks: MixTrackState[]): SongMap {
  return { ...createEmptySongMap(), mixState: { tracks } }
}

const roundTrip = (sm: SongMap): SongMap => parseSongMap(JSON.stringify(sm))

describe('mixState.liveSlot — .smap round-trip', () => {
  it('keeps an explicit link through serialize → parse', () => {
    const sm = withMix([
      { key: 'stem:drums.wav', volume: 1 },
      { key: 'stem:percussion.wav', volume: 0.8, liveSlot: 'drums' },
    ])
    const back = roundTrip(sm)
    expect(back.mixState?.tracks[1]?.liveSlot).toBe('drums')
  })

  it("keeps an explicit 'none' — it means something different from absent", () => {
    const back = roundTrip(withMix([{ key: 'stem:drums.wav', volume: 1, liveSlot: 'none' }]))
    expect(back.mixState?.tracks[0]?.liveSlot).toBe('none')
  })

  it('leaves an unconfigured track absent, so it keeps following its name', () => {
    const back = roundTrip(withMix([{ key: 'stem:drums.wav', volume: 1 }]))
    expect(back.mixState?.tracks[0]?.liveSlot).toBeUndefined()
  })

  it('drops an unknown slot from a newer build instead of refusing the file', () => {
    const raw = JSON.parse(JSON.stringify(withMix([{ key: 'stem:x.wav', volume: 1 }])))
    raw.mixState.tracks[0].liveSlot = 'trumpet'
    const back = parseSongMap(JSON.stringify(raw))
    expect(back.mixState?.tracks[0]?.liveSlot).toBeUndefined()
    expect(back.mixState?.tracks[0]?.key).toBe('stem:x.wav') // the track survives
  })

  it('keeps a channel EQ through serialize → parse', () => {
    const back = roundTrip(
      withMix([
        {
          key: 'stem:drums.wav',
          volume: 1,
          eq: { enabled: true, hpf: 80, low: { freq: 100, gain: 3 }, lowMid: { freq: 400, gain: -2, q: 1.4 } },
        },
      ]),
    )
    const eq = back.mixState?.tracks[0]?.eq
    expect(eq?.hpf).toBe(80)
    expect(eq?.low?.gain).toBe(3)
    expect(eq?.lowMid?.q).toBe(1.4)
  })

  it('clamps an out-of-range EQ from disk instead of trusting it', () => {
    const raw = JSON.parse(JSON.stringify(withMix([{ key: 'stem:x.wav', volume: 1 }])))
    raw.mixState.tracks[0].eq = { low: { freq: 99999, gain: 500 } }
    const eq = parseSongMap(JSON.stringify(raw)).mixState?.tracks[0]?.eq
    expect(eq!.low!.gain).toBeLessThanOrEqual(15)
    expect(eq!.low!.freq).toBeLessThanOrEqual(320)
  })

  it('leaves a track with no EQ absent', () => {
    const back = roundTrip(withMix([{ key: 'stem:drums.wav', volume: 1 }]))
    expect(back.mixState?.tracks[0]?.eq).toBeUndefined()
  })

  it('a round-tripped map still validates', () => {
    const sm = withMix([
      { key: 'stem:perc.wav', volume: 1, liveSlot: 'drums' },
      { key: 'stem:drums.wav', volume: 1, liveSlot: 'drums' },
      { key: 'cue', volume: 1, liveSlot: 'none' },
    ])
    expect(validateSongMap(roundTrip(sm)).ok).toBe(true)
  })
})
