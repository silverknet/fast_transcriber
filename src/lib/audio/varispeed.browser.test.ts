import { describe, expect, it } from 'vitest'
import { MixerEngine } from './mixerEngine'
import { varispeedRate } from './varispeed'

/**
 * The load-bearing claim of naive transpose is that the ORIGINAL AUDIO IS NEVER
 * MODIFIED — the rate is a playback scalar, so `transpose⁻¹(transpose(x)) === x`
 * exactly. Asserting that needs real rendering, so these run in Chromium and
 * compare actual samples.
 *
 * Rendering uses an OfflineAudioContext directly (the same
 * `AudioBufferSourceNode.playbackRate` the engine sets); the engine's own
 * buffer-time ↔ wall-time bookkeeping is covered separately below.
 */

const SR = 44100

/** A 220 Hz tone — a pitch shift is trivially measurable on it. */
function toneBuffer(seconds = 1, freq = 220): AudioBuffer {
  const len = Math.floor(SR * seconds)
  const ctx = new OfflineAudioContext(1, len, SR)
  const buf = ctx.createBuffer(1, len, SR)
  const d = buf.getChannelData(0)
  for (let i = 0; i < len; i++) d[i] = 0.5 * Math.sin((2 * Math.PI * freq * i) / SR)
  return buf
}

/** Play `src` at `rate` and capture the result. */
async function renderAtRate(src: AudioBuffer, rate: number, seconds: number): Promise<AudioBuffer> {
  const ctx = new OfflineAudioContext(1, Math.floor(SR * seconds), SR)
  const node = ctx.createBufferSource()
  node.buffer = src
  node.playbackRate.value = rate
  node.connect(ctx.destination)
  node.start(0)
  return await ctx.startRendering()
}

/** Dominant frequency via a coarse magnitude scan. */
function dominantHz(d: Float32Array, from = 100, to = 900): number {
  let bestHz = 0
  let best = -1
  const n = Math.min(d.length, SR / 2)
  for (let hz = from; hz <= to; hz += 1) {
    let re = 0
    let im = 0
    for (let i = 0; i < n; i++) {
      const w = (2 * Math.PI * hz * i) / SR
      re += d[i]! * Math.cos(w)
      im += d[i]! * Math.sin(w)
    }
    const mag = re * re + im * im
    if (mag > best) {
      best = mag
      bestHz = hz
    }
  }
  return bestHz
}

describe('naive transpose — the original audio is never modified', () => {
  it('leaves the source buffer untouched after playing it transposed', async () => {
    const src = toneBuffer(0.5)
    const before = Float32Array.from(src.getChannelData(0))
    await renderAtRate(src, varispeedRate(5), 0.5)
    const after = src.getChannelData(0)
    // Sample-for-sample identical: the rate lives on the NODE, not the buffer.
    expect(after.length).toBe(before.length)
    for (let i = 0; i < before.length; i++) {
      if (after[i] !== before[i]) throw new Error(`source buffer mutated at sample ${i}`)
    }
  }, 30_000)

  it('transpose⁻¹(transpose(x)) is bit-identical to x', async () => {
    const src = toneBuffer(0.4)
    // Go up 4 semitones, come back down 4: the offset is 0, so the rate is
    // recomputed as exactly 1 and playback is the untouched original.
    const net = 4 - 4
    expect(varispeedRate(net)).toBe(1)
    const straight = await renderAtRate(src, 1, 0.4)
    const roundTripped = await renderAtRate(src, varispeedRate(net), 0.4)
    const a = straight.getChannelData(0)
    const b = roundTripped.getChannelData(0)
    for (let i = 0; i < a.length; i++) {
      if (a[i] !== b[i]) throw new Error(`round trip differs at sample ${i}: ${a[i]} vs ${b[i]}`)
    }
  }, 30_000)
})

describe('naive transpose — it actually transposes', () => {
  it('+12 semitones lands an octave up', async () => {
    const out = await renderAtRate(toneBuffer(1), varispeedRate(12), 0.4)
    expect(dominantHz(out.getChannelData(0))).toBeCloseTo(440, -1)
  }, 30_000)

  it('-12 semitones lands an octave down', async () => {
    const out = await renderAtRate(toneBuffer(1), varispeedRate(-12), 0.4)
    expect(dominantHz(out.getChannelData(0))).toBeCloseTo(110, -1)
  }, 30_000)

  it('+2 semitones raises the pitch by the equal-tempered ratio', async () => {
    const out = await renderAtRate(toneBuffer(1), varispeedRate(2), 0.4)
    expect(dominantHz(out.getChannelData(0))).toBeCloseTo(220 * varispeedRate(2), -1)
  }, 30_000)

  it('0 semitones changes nothing', async () => {
    const out = await renderAtRate(toneBuffer(1), varispeedRate(0), 0.4)
    expect(dominantHz(out.getChannelData(0))).toBeCloseTo(220, -1)
  }, 30_000)
})

describe('MixerEngine varispeed bookkeeping', () => {
  it('reports the playhead in ORIGINAL audio time, so the .smap grid still lines up', async () => {
    const engine = new MixerEngine()
    try {
      engine.setTrack({
        key: 'song',
        label: 'Song',
        buffer: toneBuffer(4),
        volume: 1,
        muted: false,
        soloed: false,
      })
      expect(engine.rate).toBe(1)
      engine.setPlaybackRate(varispeedRate(12)) // double speed
      expect(engine.rate).toBeCloseTo(2, 9)

      await engine.play(0)
      const startCtx = engine.currentCtxTime()
      // Wait for real audio-clock time to pass.
      await new Promise((r) => setTimeout(r, 250))
      const wallElapsed = engine.currentCtxTime() - startCtx
      const pos = engine.positionSec()
      // At 2x, the playhead advances ~2 audio-seconds per wall-second. Generous
      // bounds — this asserts the SCALING, not the scheduler's precision.
      expect(pos).toBeGreaterThan(wallElapsed * 1.5)
      engine.stop()
    } finally {
      await engine.ac.close().catch(() => {})
    }
  }, 30_000)

  it('setting the rate mid-playback does not jump the playhead', async () => {
    const engine = new MixerEngine()
    try {
      engine.setTrack({
        key: 'song',
        label: 'Song',
        buffer: toneBuffer(6),
        volume: 1,
        muted: false,
        soloed: false,
      })
      await engine.play(0)
      await new Promise((r) => setTimeout(r, 200))
      const before = engine.positionSec()
      engine.setPlaybackRate(varispeedRate(7))
      const after = engine.positionSec()
      // Re-anchoring must be continuous: the position is where it was, not
      // re-derived as if the whole elapsed span had run at the new rate.
      expect(Math.abs(after - before)).toBeLessThan(0.05)
      engine.stop()
    } finally {
      await engine.ac.close().catch(() => {})
    }
  }, 30_000)

  it('rate 1 leaves the transport math exactly as it was', async () => {
    const engine = new MixerEngine()
    try {
      engine.setPlaybackRate(1)
      expect(engine.rate).toBe(1)
      engine.setTrack({
        key: 'song',
        label: 'Song',
        buffer: toneBuffer(3),
        volume: 1,
        muted: false,
        soloed: false,
      })
      await engine.play(1.25)
      // `play()` anchors PLAY_START_LOOKAHEAD_SEC (0.04) ahead, so right after
      // the call the playhead sits just short of the seek target — pre-existing
      // behaviour that rate 1 must leave exactly alone.
      expect(engine.positionSec()).toBeCloseTo(1.25, 1)
      expect(engine.positionSec()).toBeLessThanOrEqual(1.25)
      engine.stop()
    } finally {
      await engine.ac.close().catch(() => {})
    }
  }, 30_000)
})
