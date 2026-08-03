import { beforeEach, describe, expect, it } from 'vitest'
import {
  bassVoiceRenderKey,
  clearBassVoiceRenderCache,
  renderBassVoice,
  type BassVoiceNote,
} from './renderBassVoice'
import { normalizeBassTone } from './bassTone'

/**
 * Re-rendering an unchanged bass track is the slow path the user actually hits:
 * reopening a song, or switching a sound back to one already auditioned. These
 * pin that a repeat is served from cache — and, just as importantly, that a
 * genuine change is NOT (a stale cache is worse than a slow render).
 */

const SR = 44100
const tone = normalizeBassTone(undefined)

const notes = (n = 40): BassVoiceNote[] =>
  Array.from({ length: n }, (_, i) => ({
    atSec: i * 0.25,
    durationSec: 0.22,
    midi: 40 + (i % 12),
    velocity: 0.8,
  }))

describe('bass voice render cache', () => {
  beforeEach(() => clearBassVoiceRenderCache())

  it('serves an identical re-render from cache, far faster', async () => {
    const frames = 20 * SR
    const t0 = performance.now()
    await renderBassVoice(notes(), tone, frames, SR)
    const coldMs = performance.now() - t0

    const t1 = performance.now()
    await renderBassVoice(notes(), tone, frames, SR)
    const warmMs = performance.now() - t1

    expect(warmMs * 5).toBeLessThan(coldMs)
  }, 120_000)

  it('a cache hit returns the same audio', async () => {
    const frames = 8 * SR
    const first = await renderBassVoice(notes(20), tone, frames, SR)
    const second = await renderBassVoice(notes(20), tone, frames, SR)
    expect(second.length).toBe(first.length)
    let maxDiff = 0
    for (let i = 0; i < first.length; i++) maxDiff = Math.max(maxDiff, Math.abs(first[i]! - second[i]!))
    expect(maxDiff).toBe(0)
  }, 120_000)

  it('a caller mutating its result cannot poison the cache', async () => {
    const frames = 4 * SR
    const first = await renderBassVoice(notes(10), tone, frames, SR)
    first.fill(0.99) // vandalise the returned buffer
    const second = await renderBassVoice(notes(10), tone, frames, SR)
    expect(second.some((v) => v !== 0.99)).toBe(true)
  }, 120_000)

  it('changing the notes is a MISS — the line must follow the chords', () => {
    const a = bassVoiceRenderKey(notes(10), tone, 4 * SR, SR)
    const b = bassVoiceRenderKey(notes(11), tone, 4 * SR, SR)
    expect(a).not.toBe(b)

    const moved = notes(10)
    moved[3] = { ...moved[3]!, midi: moved[3]!.midi + 1 }
    expect(bassVoiceRenderKey(moved, tone, 4 * SR, SR)).not.toBe(a)
  })

  it('changing the SOUND or the tone is a miss', () => {
    const base = bassVoiceRenderKey(notes(10), tone, 4 * SR, SR)
    expect(bassVoiceRenderKey(notes(10), tone, 4 * SR, SR, 'jazz')).not.toBe(base)
    expect(bassVoiceRenderKey(notes(10), { ...tone, cutoffHz: tone.cutoffHz + 100 }, 4 * SR, SR)).not.toBe(
      base,
    )
  })

  it('changing the song LENGTH is a miss', () => {
    const a = bassVoiceRenderKey(notes(10), tone, 4 * SR, SR)
    expect(bassVoiceRenderKey(notes(10), tone, 8 * SR, SR)).not.toBe(a)
  })

  it('identical inputs give the same key regardless of object identity', () => {
    expect(bassVoiceRenderKey(notes(10), tone, 4 * SR, SR)).toBe(
      bassVoiceRenderKey(notes(10), { ...tone }, 4 * SR, SR),
    )
  })

  it('a switched-back sound is still cached after auditioning others', async () => {
    const frames = 6 * SR
    await renderBassVoice(notes(15), tone, frames, SR, undefined)
    await renderBassVoice(notes(15), { ...tone, cutoffHz: 900 }, frames, SR, undefined)

    const t0 = performance.now()
    await renderBassVoice(notes(15), tone, frames, SR, undefined) // back to the first
    const warmMs = performance.now() - t0

    const t1 = performance.now()
    await renderBassVoice(notes(15), { ...tone, cutoffHz: 1234 }, frames, SR, undefined) // brand new
    const coldMs = performance.now() - t1

    expect(warmMs * 3).toBeLessThan(coldMs)
  }, 120_000)
})
