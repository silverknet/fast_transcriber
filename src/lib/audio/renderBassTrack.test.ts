import { describe, expect, it } from 'vitest'
import {
  bassVelocityGain,
  mixBassEvents,
  synthBassNote,
  trimBassOverlaps,
} from './renderBassTrack'
import { normalizeDrumBuffer } from './renderDrumTrack'
import type { BassMidiEvent } from '$lib/songmap/types'

const SR = 44100

function note(timeSec: number, midi = 40, durationSec = 0.4, velocity = 0.8): BassMidiEvent {
  return { timeSec, durationSec, midi, velocity }
}

describe('synthBassNote', () => {
  it('is deterministic, finite, bounded, and lands where asked', () => {
    const a = new Float32Array(SR)
    const b = new Float32Array(SR)
    synthBassNote(a, SR, 0.25, 0.4, 40, 1)
    synthBassNote(b, SR, 0.25, 0.4, 40, 1)
    expect(a).toEqual(b)
    const startIdx = Math.round(0.25 * SR)
    for (let i = 0; i < startIdx; i++) expect(a[i]).toBe(0)
    for (let i = Math.ceil((0.25 + 0.4) * SR) + 1; i < SR; i++) expect(a[i]).toBe(0)
    let peak = 0
    for (const v of a) {
      expect(Number.isFinite(v)).toBe(true)
      peak = Math.max(peak, Math.abs(v))
    }
    expect(peak).toBeGreaterThan(0.05)
    expect(peak).toBeLessThanOrEqual(1)
  })

  it('pitch tracks midi: dominant period of E1 (midi 28) ≈ 41.2 Hz', () => {
    const buf = new Float32Array(SR)
    synthBassNote(buf, SR, 0, 1.0, 28, 1)
    // Count zero crossings over the sustained middle of the note.
    let crossings = 0
    const from = Math.round(0.1 * SR)
    const to = Math.round(0.9 * SR)
    for (let i = from + 1; i < to; i++) {
      if ((buf[i - 1]! <= 0 && buf[i]! > 0) || (buf[i - 1]! >= 0 && buf[i]! < 0)) crossings++
    }
    const estHz = crossings / 2 / 0.8
    // Harmonics add extra crossings, so allow a loose band around 41.2 Hz.
    expect(estHz).toBeGreaterThan(35)
    expect(estHz).toBeLessThan(41.2 * 2.2)
  })

  it('velocity controls brightness: soft notes carry less high-frequency energy', () => {
    const loud = new Float32Array(SR)
    const soft = new Float32Array(SR)
    // Same gain for both — isolates the brightness (spectral) effect.
    synthBassNote(loud, SR, 0, 0.6, 40, 1, 1)
    synthBassNote(soft, SR, 0, 0.6, 40, 1, 0.2)
    // First-difference energy is a crude high-frequency emphasis.
    const hfEnergy = (buf: Float32Array) => {
      let s = 0
      for (let i = 1; i < buf.length; i++) s += (buf[i]! - buf[i - 1]!) ** 2
      return s
    }
    const lfEnergy = (buf: Float32Array) => {
      let s = 0
      for (const v of buf) s += v * v
      return s
    }
    const loudTilt = hfEnergy(loud) / lfEnergy(loud)
    const softTilt = hfEnergy(soft) / lfEnergy(soft)
    expect(loudTilt).toBeGreaterThan(softTilt * 1.3)
  })

  it('release fade ends the note near zero (no click)', () => {
    const buf = new Float32Array(SR)
    synthBassNote(buf, SR, 0, 0.5, 40, 1)
    const endIdx = Math.floor(0.5 * SR) - 1
    expect(Math.abs(buf[endIdx]!)).toBeLessThan(0.02)
  })
})

describe('trimBassOverlaps', () => {
  it('trims a ringing note to its successor and leaves gaps alone', () => {
    const out = trimBassOverlaps([note(0, 40, 1.0), note(0.5, 43, 0.3), note(1.2, 45, 0.2)])
    expect(out[0]!.durationSec).toBeCloseTo(0.5, 6)
    expect(out[1]!.durationSec).toBeCloseTo(0.3, 6) // 0.5+0.3 ≤ 1.2 — untouched
    expect(out[2]!.durationSec).toBeCloseTo(0.2, 6)
  })

  it('merges same-pitch same-slot duplicates, keeps a grace note for pitch collisions', () => {
    const dup = trimBassOverlaps([note(1, 40, 0.3, 0.5), note(1.0005, 40, 0.5, 0.9)])
    expect(dup).toHaveLength(1)
    expect(dup[0]!.velocity).toBe(0.9)
    expect(dup[0]!.durationSec).toBe(0.5)

    const clash = trimBassOverlaps([note(1, 40, 0.3), note(1.0005, 45, 0.5)])
    expect(clash).toHaveLength(2)
    expect(clash[0]!.durationSec).toBeCloseTo(0.02, 6)
  })
})

describe('mixBassEvents', () => {
  it('honors trim bounds and places notes at shift + (t − trimStart)', () => {
    const dst = new Float32Array(SR * 4)
    mixBassEvents(
      dst,
      SR,
      [note(10.0, 40, 0.3), note(9.0, 40, 0.3), note(20.5, 40, 0.3)],
      9.5,
      20,
      1.0,
    )
    const at = Math.round((1.0 + (10.0 - 9.5)) * SR)
    // Nothing before the placed note (the 9.0s event was excluded).
    for (let i = 0; i < at; i++) expect(dst[i]).toBe(0)
    let sounding = 0
    for (let i = at; i < at + Math.floor(0.3 * SR); i++) {
      if (dst[i] !== 0) sounding++
    }
    expect(sounding).toBeGreaterThan(0.2 * SR)
    // Nothing after it either (the 20.5s event was excluded).
    for (let i = at + Math.ceil(0.31 * SR); i < dst.length; i++) expect(dst[i]).toBe(0)
  })

  it('clamps a note ringing past trim end', () => {
    const dst = new Float32Array(SR * 2)
    mixBassEvents(dst, SR, [note(9.8, 40, 2.0)], 9.5, 10.0, 0)
    // Note starts at 0.3s, may sound only until trim end (0.5s).
    for (let i = Math.ceil(0.51 * SR); i < dst.length; i++) expect(dst[i]).toBe(0)
  })

  it('velocity curve keeps quiet notes carrying and scales up', () => {
    expect(bassVelocityGain(0)).toBeCloseTo(0.4, 6)
    expect(bassVelocityGain(1)).toBeCloseTo(1, 6)
    expect(bassVelocityGain(0.5)).toBeGreaterThan(0.4)
    expect(bassVelocityGain(0.5)).toBeLessThan(1)
  })

  it('normalization to −18 dB leaves bass quieter than the drums target', () => {
    const mk = () => {
      const buf = new Float32Array(SR)
      mixBassEvents(buf, SR, [note(0.1, 40, 0.6, 1)], 0, 1, 0)
      return buf
    }
    const rmsDbOf = (buf: Float32Array) => {
      let s = 0
      let n = 0
      for (const v of buf) {
        if (Math.abs(v) > 1e-3) {
          s += v * v
          n++
        }
      }
      return 20 * Math.log10(Math.sqrt(s / Math.max(1, n)))
    }
    const bass = mk()
    normalizeDrumBuffer(bass, -18)
    const drums = mk()
    normalizeDrumBuffer(drums, -16)
    expect(rmsDbOf(bass)).toBeLessThan(rmsDbOf(drums))
    expect(rmsDbOf(bass)).toBeCloseTo(-18, 0.7)
  })
})
