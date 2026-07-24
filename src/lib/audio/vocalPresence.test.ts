import { describe, it, expect } from 'vitest'
import {
  analyzeVocalPresence,
  EMPTY_VOCAL_RMS_DBFS,
  vocalPresenceFromBuffer,
} from './vocalPresence'

const SR = 22050

function silence(sec: number, floorAmp = 0): Float32Array {
  const a = new Float32Array(Math.floor(sec * SR))
  if (floorAmp > 0) for (let i = 0; i < a.length; i++) a[i] = (Math.random() * 2 - 1) * floorAmp
  return a
}

/** A tone at `amp` for the whole span — stand-in for a present vocal. */
function tone(sec: number, amp: number, freq = 220): Float32Array {
  const n = Math.floor(sec * SR)
  const a = new Float32Array(n)
  for (let i = 0; i < n; i++) a[i] = amp * Math.sin((2 * Math.PI * freq * i) / SR)
  return a
}

describe('analyzeVocalPresence', () => {
  it('flags pure silence as empty', () => {
    const r = analyzeVocalPresence(silence(3), SR)
    expect(r.hasVocals).toBe(false)
    expect(r.activeRatio).toBe(0)
  })

  it('flags an instrumental-level residual (~-77 dBFS) as empty', () => {
    // 10^(-77/20) ≈ 1.4e-4 amplitude noise floor — like Tur att vi lever.
    const r = analyzeVocalPresence(silence(5, 1.4e-4), SR)
    expect(r.rmsDb).toBeLessThan(EMPTY_VOCAL_RMS_DBFS)
    expect(r.hasVocals).toBe(false)
  })

  it('detects a real-level vocal (~-20 dBFS) as present', () => {
    const r = analyzeVocalPresence(tone(5, 0.1), SR) // 0.1 ≈ -20 dBFS peak
    expect(r.hasVocals).toBe(true)
    expect(r.rmsDb).toBeGreaterThan(EMPTY_VOCAL_RMS_DBFS)
    expect(r.activeRatio).toBeGreaterThan(0.9)
  })

  it('keeps a quiet-but-real vocal (~-32 dBFS, the quietest real stem) present', () => {
    // 10^(-29/20) ≈ 0.0355 amplitude → ~-32 dBFS RMS for a sine.
    const r = analyzeVocalPresence(tone(5, 0.0355), SR)
    expect(r.hasVocals).toBe(true)
  })

  it('is empty on a very short/near-silent buffer', () => {
    expect(analyzeVocalPresence(new Float32Array(0), SR).hasVocals).toBe(false)
  })

  it('downmixes a stereo AudioBuffer-like object', () => {
    const left = tone(2, 0.1)
    const right = tone(2, 0.1)
    const fake = {
      numberOfChannels: 2,
      length: left.length,
      sampleRate: SR,
      getChannelData: (c: number) => (c === 0 ? left : right),
    } as unknown as AudioBuffer
    expect(vocalPresenceFromBuffer(fake).hasVocals).toBe(true)
  })
})
