import { describe, expect, it } from 'vitest'
import type { ProjectMastering } from '$lib/project/types'
import {
  bufferRmsDb,
  renderBufferThroughMasterChain,
  renderBufferThroughStemChain,
} from './mastering'

const SR = 44100

function toneBuffer(opts: { freq?: number; seconds?: number; amp?: number | ((t: number) => number) }): AudioBuffer {
  const { freq = 110, seconds = 2, amp = 0.5 } = opts
  const len = Math.floor(SR * seconds)
  const ctx = new OfflineAudioContext(1, len, SR)
  const buf = ctx.createBuffer(1, len, SR)
  const d = buf.getChannelData(0)
  for (let i = 0; i < len; i++) {
    const a = typeof amp === 'function' ? amp(i / SR) : amp
    d[i] = a * Math.sin((2 * Math.PI * freq * i) / SR)
  }
  return buf
}

function segmentRmsDb(buf: AudioBuffer, fromSec: number, toSec: number): number {
  const d = buf.getChannelData(0)
  const a = Math.floor(fromSec * SR)
  const b = Math.min(d.length, Math.floor(toSec * SR))
  let sum = 0
  for (let i = a; i < b; i++) sum += d[i]! * d[i]!
  return 20 * Math.log10(Math.sqrt(sum / Math.max(1, b - a)))
}

function peakOf(buf: AudioBuffer): number {
  const d = buf.getChannelData(0)
  let p = 0
  for (let i = 0; i < d.length; i++) p = Math.max(p, Math.abs(d[i]!))
  return p
}

describe('mastering chains (real browser)', () => {
  it('loudness matching pulls a quiet bass toward the shared target', async () => {
    // ~-24 dB RMS sine (amp ≈ 0.0893) → bass target -18 dB → expect ≈ +6 dB.
    const src = toneBuffer({ amp: 0.0893 })
    const cfg: ProjectMastering = { enabled: true, matchLoudness: true, stems: { bass: 'off' } }
    const out = await renderBufferThroughStemChain(src, 'bass', cfg)
    const inRms = bufferRmsDb(src)
    const outRms = bufferRmsDb(out)
    expect(inRms).toBeLessThan(-22)
    expect(outRms).toBeGreaterThan(inRms + 4)
    expect(Math.abs(outRms - -18)).toBeLessThan(1.5)
  }, 20_000)

  it('firm compression narrows the gap between quiet and loud passages', async () => {
    // First second quiet (0.06), second second loud (0.9).
    const src = toneBuffer({ seconds: 2, amp: (t) => (t < 1 ? 0.06 : 0.9) })
    const cfg: ProjectMastering = { enabled: true, matchLoudness: false, stems: { bass: 'firm' } }
    const out = await renderBufferThroughStemChain(src, 'bass', cfg)
    // Measure away from the boundary so attack/release transients don't skew.
    const inGap = segmentRmsDb(src, 1.4, 1.9) - segmentRmsDb(src, 0.4, 0.9)
    const outGap = segmentRmsDb(out, 1.4, 1.9) - segmentRmsDb(out, 0.4, 0.9)
    expect(outGap).toBeLessThan(inGap - 3) // meaningfully more even
    expect(outGap).toBeGreaterThan(0) // loud still louder — evened, not squashed flat
  }, 20_000)

  it('bypasses cleanly when mastering is disabled', async () => {
    const src = toneBuffer({ amp: 0.3 })
    const cfg: ProjectMastering = { enabled: false, matchLoudness: true, stems: { bass: 'firm' } }
    const out = await renderBufferThroughStemChain(src, 'bass', cfg)
    expect(out).toBe(src)
  })

  it('master chain tames a hot summed mix (limiter engages)', async () => {
    const src = toneBuffer({ amp: 0.99, freq: 220 })
    const cfg: ProjectMastering = { enabled: true, masterGlue: true }
    const out = await renderBufferThroughMasterChain(src, cfg)
    expect(peakOf(out)).toBeLessThan(peakOf(src))
    expect(peakOf(out)).toBeLessThan(0.95)
    // Still audible — not silenced.
    expect(bufferRmsDb(out)).toBeGreaterThan(-20)
  }, 20_000)

  it('master chain is a no-op when glue is off', async () => {
    const src = toneBuffer({ amp: 0.5 })
    const cfg: ProjectMastering = { enabled: true, masterGlue: false }
    const out = await renderBufferThroughMasterChain(src, cfg)
    expect(out).toBe(src)
  })
})
