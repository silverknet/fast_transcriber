/**
 * The detected bass carries a VOICE, like the machine does.
 *
 * The renderer always accepted `tone`/`soundId` — the machine passed them and
 * the detected path passed nothing, so "BarBro Bass" was stuck on one
 * hard-coded sound with no way to change it. These pin the two fields through
 * the parser, including the promise that a song which never chose a sound
 * still renders exactly as before.
 */
import { describe, expect, it } from 'vitest'
import { parseSongMap } from './parse'
import { serializeSongMap } from './serialize'
import { createEmptySongMap } from './factory'
import type { SongMap } from './types'

function withBassMidi(extra: Record<string, unknown>): SongMap {
  const sm = createEmptySongMap()
  const raw = JSON.parse(serializeSongMap(sm)) as Record<string, unknown>
  raw.bassMidi = {
    events: [{ timeSec: 1, durationSec: 0.5, midi: 40, velocity: 0.8 }],
    analyzedAt: '2026-01-01T00:00:00.000Z',
    analyzerVersion: 1,
    sourceStem: 'stems/best/bass.wav',
    audioFingerprint: 'abc:123',
    ...extra,
  }
  return parseSongMap(JSON.stringify(raw), { validate: false })
}

describe('the detected bass voice survives a load', () => {
  it('keeps the chosen sound id', () => {
    expect(withBassMidi({ sound: 'upright' }).bassMidi?.sound).toBe('upright')
  })

  it('keeps the tone, normalized like the machine’s', () => {
    const tone = withBassMidi({ tone: { drive: 0.4 } }).bassMidi?.tone
    expect(tone, 'a partial tone must still load').toBeDefined()
    expect(tone!.drive).toBeCloseTo(0.4, 6)
  })

  it('round-trips through serialize', () => {
    const once = withBassMidi({ sound: 'upright', tone: { drive: 0.4 } })
    const twice = parseSongMap(serializeSongMap(once), { validate: false })
    expect(twice.bassMidi?.sound).toBe('upright')
    expect(twice.bassMidi?.tone?.drive).toBeCloseTo(0.4, 6)
  })

  it('a song that never chose one has NO voice — it renders exactly as before', () => {
    const bm = withBassMidi({}).bassMidi
    expect(bm?.sound).toBeUndefined()
    expect(bm?.tone).toBeUndefined()
  })

  it('junk is dropped rather than loaded broken', () => {
    expect(withBassMidi({ sound: 42, tone: 'loud' }).bassMidi?.sound).toBeUndefined()
    expect(withBassMidi({ sound: 42, tone: 'loud' }).bassMidi?.tone).toBeUndefined()
  })
})

describe('changing the bass sound invalidates the saved render', () => {
  /**
   * The trap this guards: a rendered WAV on disk is treated as fresh while its
   * fingerprint matches. If the voice were not part of that fingerprint,
   * picking a different bass would leave the OLD sound playing from the old
   * file and look like the picker doing nothing.
   */
  it('a different sound changes the fingerprint', async () => {
    const { fingerprintBassTrackInputs } = await import('./bassTrackFingerprint')
    const a = fingerprintBassTrackInputs(withBassMidi({ sound: 'finger' }))
    const b = fingerprintBassTrackInputs(withBassMidi({ sound: 'upright' }))
    expect(a).not.toBe(b)
  })

  it('a different tone changes it too', async () => {
    const { fingerprintBassTrackInputs } = await import('./bassTrackFingerprint')
    const a = fingerprintBassTrackInputs(withBassMidi({ tone: { drive: 0.2 } }))
    const b = fingerprintBassTrackInputs(withBassMidi({ tone: { drive: 0.9 } }))
    expect(a).not.toBe(b)
  })

  it('the same voice twice is the same fingerprint — no pointless re-renders', async () => {
    const { fingerprintBassTrackInputs } = await import('./bassTrackFingerprint')
    expect(fingerprintBassTrackInputs(withBassMidi({ sound: 'upright' }))).toBe(
      fingerprintBassTrackInputs(withBassMidi({ sound: 'upright' })),
    )
  })
})
