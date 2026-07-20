/**
 * Contract test for the BUNDLED acoustic kit samples in
 * `static/drums/acoustic/` — the browser loader assumes small mono
 * 44.1 kHz 16-bit WAVs, and LICENSE.md must travel with them.
 */
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const DIR = join(__dirname, '../../../static/drums/acoustic')
const VOICES = ['kick', 'snare', 'hihat', 'tom', 'cymbal'] as const

function wavHeader(buf: Buffer) {
  return {
    riff: buf.toString('ascii', 0, 4),
    wave: buf.toString('ascii', 8, 12),
    format: buf.readUInt16LE(20),
    channels: buf.readUInt16LE(22),
    sampleRate: buf.readUInt32LE(24),
    bitsPerSample: buf.readUInt16LE(34),
  }
}

describe('bundled acoustic kit samples', () => {
  it('ships all five voices with provenance', () => {
    for (const v of VOICES) expect(existsSync(join(DIR, `${v}.wav`))).toBe(true)
    const license = readFileSync(join(DIR, 'LICENSE.md'), 'utf8')
    expect(license).toMatch(/CC0/)
    for (const v of VOICES) expect(license).toContain(`${v}.wav`)
  })

  it('every sample is mono 44.1 kHz 16-bit PCM under 250 KB', () => {
    for (const v of VOICES) {
      const buf = readFileSync(join(DIR, `${v}.wav`))
      expect(buf.length).toBeLessThan(250 * 1024)
      const h = wavHeader(buf)
      expect(h.riff).toBe('RIFF')
      expect(h.wave).toBe('WAVE')
      expect(h.format).toBe(1) // PCM
      expect(h.channels).toBe(1)
      expect(h.sampleRate).toBe(44100)
      expect(h.bitsPerSample).toBe(16)
    }
  })
})
