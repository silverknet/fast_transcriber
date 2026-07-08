import { describe, expect, it } from 'vitest'
import { pitchShiftAudioBuffer } from './clientPitchShift'

const SR = 44100

/** A mono sine `AudioBuffer` at `freq` Hz for `seconds`. */
function sineBuffer(freq: number, seconds = 1): AudioBuffer {
  const len = Math.floor(SR * seconds)
  const ctx = new OfflineAudioContext(1, len, SR)
  const buf = ctx.createBuffer(1, len, SR)
  const data = buf.getChannelData(0)
  for (let i = 0; i < len; i++) data[i] = Math.sin((2 * Math.PI * freq * i) / SR)
  return buf
}

/** Estimate the dominant frequency of a mono buffer via zero-crossing rate over
 * a steady middle window (robust for a clean sine). */
function estimateFreq(buf: AudioBuffer): number {
  const d = buf.getChannelData(0)
  const start = Math.floor(d.length * 0.25)
  const end = Math.floor(d.length * 0.75)
  let crossings = 0
  for (let i = start + 1; i < end; i++) {
    if ((d[i - 1]! <= 0 && d[i]! > 0) || (d[i - 1]! >= 0 && d[i]! < 0)) crossings++
  }
  const windowSec = (end - start) / SR
  return crossings / 2 / windowSec // two zero-crossings per cycle
}

function peak(buf: AudioBuffer): number {
  const d = buf.getChannelData(0)
  let p = 0
  for (let i = 0; i < d.length; i++) p = Math.max(p, Math.abs(d[i]!))
  return p
}

describe('clientPitchShift (real browser, signalsmith-stretch)', () => {
  it('returns the same buffer for a 0-semitone shift', async () => {
    const src = sineBuffer(440, 0.5)
    const out = await pitchShiftAudioBuffer(src, 0)
    expect(out).toBe(src)
  })

  it('shifts a 440 Hz tone up 12 semitones to ~880 Hz', async () => {
    const src = sineBuffer(440, 1)
    const out = await pitchShiftAudioBuffer(src, 12)
    // Length preserved (pitch shift, not time stretch).
    expect(out.length).toBe(src.length)
    // Non-silent output.
    expect(peak(out)).toBeGreaterThan(0.05)
    // Fundamental doubled (±4%).
    const f = estimateFreq(out)
    expect(f).toBeGreaterThan(880 * 0.96)
    expect(f).toBeLessThan(880 * 1.04)
  }, 20_000)

  it('shifts a 440 Hz tone down 12 semitones to ~220 Hz', async () => {
    const src = sineBuffer(440, 1)
    const out = await pitchShiftAudioBuffer(src, -12)
    expect(out.length).toBe(src.length)
    expect(peak(out)).toBeGreaterThan(0.05)
    const f = estimateFreq(out)
    expect(f).toBeGreaterThan(220 * 0.96)
    expect(f).toBeLessThan(220 * 1.04)
  }, 20_000)

  it('shifts 30s of stereo at a usable speed (logged)', async () => {
    const len = SR * 30
    const ctx = new OfflineAudioContext(2, len, SR)
    const src = ctx.createBuffer(2, len, SR)
    for (let c = 0; c < 2; c++) {
      const d = src.getChannelData(c)
      for (let i = 0; i < len; i++) d[i] = Math.sin((2 * Math.PI * 220 * (c + 1) * i) / SR) * 0.5
    }
    const t0 = performance.now()
    const out = await pitchShiftAudioBuffer(src, 2)
    const ms = performance.now() - t0
    // eslint-disable-next-line no-console
    console.log(`[speed] 30s stereo +2 semitones rendered in ${Math.round(ms)}ms`)
    expect(out.length).toBe(src.length)
    // Sanity bound so a pathological slowdown fails loudly (not a benchmark).
    expect(ms).toBeLessThan(30_000)
  }, 60_000)

  it('keeps the output roughly aligned with the input (no big leading delay)', async () => {
    // A tone that starts at t=0; after shifting, energy should still begin
    // near the start (leading silence trimmed), not seconds late.
    const src = sineBuffer(440, 0.5)
    const out = await pitchShiftAudioBuffer(src, 5)
    const d = out.getChannelData(0)
    let firstAudible = d.length
    for (let i = 0; i < d.length; i++) {
      if (Math.abs(d[i]!) > 0.02) {
        firstAudible = i
        break
      }
    }
    // Within ~30 ms of the start.
    expect(firstAudible).toBeLessThan(SR * 0.03)
  }, 20_000)
})
