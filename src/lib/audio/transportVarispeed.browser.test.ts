import { describe, expect, it } from 'vitest'
import { SONGMAP_FORMAT_VERSION } from '$lib/songmap/version'
import type { SongMap } from '$lib/songmap/types'

/**
 * End-to-end on the REAL `UnifiedTransport` with a REAL `AudioContext` — the
 * exact path `/edit` plays through. The unit tests use a mocked context, so a
 * wiring break between the transport and a genuine `AudioBufferSourceNode`
 * would not show up there.
 */

function makeSong(): SongMap {
  const bd = 0.5
  const beatsPerBar = 4
  const barCount = 4
  const beats: SongMap['timeline']['beats'] = []
  const bars: SongMap['timeline']['bars'] = []
  for (let bar = 0; bar < barCount; bar++) {
    const barId = `bar${bar}`
    const barStart = bar * beatsPerBar * bd
    const beatIds: string[] = []
    for (let i = 0; i < beatsPerBar; i++) {
      const id = `b${bar}_${i}`
      beatIds.push(id)
      beats.push({ id, barId, indexInBar: i, timeSec: barStart + i * bd })
    }
    bars.push({
      id: barId,
      index: bar,
      startSec: barStart,
      endSec: barStart + beatsPerBar * bd,
      meter: { numerator: beatsPerBar, denominator: 4 },
      beatCount: beatsPerBar,
      beatIds,
    })
  }
  return {
    formatVersion: SONGMAP_FORMAT_VERSION,
    metadata: {
      title: 'T',
      bpm: 120,
      createdAt: '2020-01-01T00:00:00.000Z',
      updatedAt: '2020-01-01T00:00:00.000Z',
    },
    audio: { fileName: 'x.wav', trim: { startSec: 0, endSec: 8 }, source: 'upload' },
    timeline: { bars, beats },
    sections: [],
    harmony: [],
    cueTracks: [],
  } as SongMap
}

/** A real WAV file (a tone), so the transport's own decode path runs. */
function wavFile(seconds = 4, freq = 220): File {
  const sr = 44100
  const n = Math.floor(sr * seconds)
  const bytes = new ArrayBuffer(44 + n * 2)
  const dv = new DataView(bytes)
  const ascii = (off: number, s: string) => {
    for (let i = 0; i < s.length; i++) dv.setUint8(off + i, s.charCodeAt(i))
  }
  ascii(0, 'RIFF')
  dv.setUint32(4, 36 + n * 2, true)
  ascii(8, 'WAVE')
  ascii(12, 'fmt ')
  dv.setUint32(16, 16, true)
  dv.setUint16(20, 1, true)
  dv.setUint16(22, 1, true)
  dv.setUint32(24, sr, true)
  dv.setUint32(28, sr * 2, true)
  dv.setUint16(32, 2, true)
  dv.setUint16(34, 16, true)
  ascii(36, 'data')
  dv.setUint32(40, n * 2, true)
  for (let i = 0; i < n; i++) {
    dv.setInt16(44 + i * 2, Math.round(0.4 * 32767 * Math.sin((2 * Math.PI * freq * i) / sr)), true)
  }
  return new File([bytes], 'x.wav', { type: 'audio/wav' })
}

async function freshTransport() {
  const mod = await import('$lib/audio/transport.svelte')
  return mod.transport
}

describe('UnifiedTransport varispeed — real AudioContext', () => {
  it('reaches the engine when the transpose is set BEFORE any audio loads', async () => {
    const t = await freshTransport()
    try {
      t.setTransposeSemitones(0)
      // The page restores the setting on mount — before decode.
      t.setTransposeSemitones(12)
      t.configure(makeSong())
      await t.loadFile(wavFile())
      expect(t.transposeRate).toBeCloseTo(2, 9)
      // The engine — not just the transport's own field — must carry it.
      expect(t.engineRateForTest()).toBeCloseTo(2, 9)
    } finally {
      t.setTransposeSemitones(0)
      t.dispose()
    }
  }, 30_000)

  it('reaches the engine when the transpose is set AFTER audio loads', async () => {
    const t = await freshTransport()
    try {
      t.setTransposeSemitones(0)
      t.configure(makeSong())
      await t.loadFile(wavFile())
      expect(t.engineRateForTest()).toBe(1)
      t.setTransposeSemitones(-12)
      expect(t.engineRateForTest()).toBeCloseTo(0.5, 9)
    } finally {
      t.setTransposeSemitones(0)
      t.dispose()
    }
  }, 30_000)

  it('returns to exactly 1 on reset', async () => {
    const t = await freshTransport()
    try {
      t.configure(makeSong())
      await t.loadFile(wavFile())
      t.setTransposeSemitones(7)
      t.setTransposeSemitones(0)
      expect(t.engineRateForTest()).toBe(1)
    } finally {
      t.dispose()
    }
  }, 30_000)
})

describe('tempo hold — the rate/stretch split reaches the engine', () => {
  it('hold=0 is pure varispeed: full rate change, stretcher bypassed', async () => {
    const t = await freshTransport()
    try {
      t.configure(makeSong())
      await t.loadFile(wavFile())
      t.setTransposeSemitones(12)
      t.setTempoHold(0)
      expect(t.engineRateForTest()).toBeCloseTo(2, 9)
      expect(t.residualShiftSemitones).toBe(0)
    } finally {
      t.setTransposeSemitones(0)
      t.setTempoHold(0)
      t.dispose()
    }
  }, 30_000)

  it('hold=1 keeps tempo: rate exactly 1, stretcher does the whole transpose', async () => {
    const t = await freshTransport()
    try {
      t.configure(makeSong())
      await t.loadFile(wavFile())
      t.setTransposeSemitones(5)
      t.setTempoHold(1)
      expect(t.engineRateForTest()).toBe(1) // no resampling → no tempo change
      expect(t.residualShiftSemitones).toBeCloseTo(5, 9)
    } finally {
      t.setTransposeSemitones(0)
      t.setTempoHold(0)
      t.dispose()
    }
  }, 30_000)

  it('partial hold splits the work between the two', async () => {
    const t = await freshTransport()
    try {
      t.configure(makeSong())
      await t.loadFile(wavFile())
      t.setTransposeSemitones(4)
      t.setTempoHold(0.5)
      const rate = t.engineRateForTest()!
      expect(rate).toBeGreaterThan(1)
      expect(rate).toBeLessThan(Math.pow(2, 4 / 12)) // less tempo change than pure varispeed
      expect(t.residualShiftSemitones).toBeCloseTo(2, 9) // stretcher covers the rest
    } finally {
      t.setTransposeSemitones(0)
      t.setTempoHold(0)
      t.dispose()
    }
  }, 30_000)

  it('holding tempo at zero transpose stays completely neutral', async () => {
    const t = await freshTransport()
    try {
      t.configure(makeSong())
      await t.loadFile(wavFile())
      t.setTempoHold(1)
      expect(t.engineRateForTest()).toBe(1)
      expect(t.residualShiftSemitones).toBe(0) // worklet must stay bypassed
    } finally {
      t.setTempoHold(0)
      t.dispose()
    }
  }, 30_000)
})

describe('live pitch shifter', () => {
  it('constructs on a real AudioContext and reports its latency', async () => {
    const { createLivePitchShifter } = await import('./livePitchShift')
    const ctx = new AudioContext()
    try {
      const s = await createLivePitchShifter(ctx, 2)
      expect(s).not.toBeNull()
      expect(s!.node).toBeInstanceOf(AudioWorkletNode)
      expect(s!.latencySec).toBeGreaterThanOrEqual(0)
      expect(s!.latencySec).toBeLessThan(1) // sane figure to compensate clicks by
      s!.setSemitones(2)
      s!.dispose()
    } finally {
      await ctx.close().catch(() => {})
    }
  }, 30_000)
})
