/**
 * THE AUDITION OVERLAY: a preview that cannot become permanent.
 *
 * "Hear this performer's mix" applies their levels to the live transport
 * graph. The whole contract is in the restore: whatever the volumes were
 * before the audition, they come back EXACTLY — through slider moves,
 * re-applies, and double-clears — and a song switch drops the audition rather
 * than carrying one performer's preview into the next song.
 */
import { describe, expect, it } from 'vitest'
import { SONGMAP_FORMAT_VERSION } from '$lib/songmap/version'
import type { SongMap } from '$lib/songmap/types'

function makeSong(): SongMap {
  const bd = 0.5
  const beats: SongMap['timeline']['beats'] = []
  const bars: SongMap['timeline']['bars'] = []
  for (let bar = 0; bar < 4; bar++) {
    const barId = `bar${bar}`
    const start = bar * 4 * bd
    const beatIds: string[] = []
    for (let i = 0; i < 4; i++) {
      const id = `b${bar}_${i}`
      beatIds.push(id)
      beats.push({ id, barId, indexInBar: i, timeSec: start + i * bd })
    }
    bars.push({
      id: barId,
      index: bar,
      startSec: start,
      endSec: start + 4 * bd,
      meter: { numerator: 4, denominator: 4 },
      beatCount: 4,
      beatIds,
    })
  }
  return {
    formatVersion: SONGMAP_FORMAT_VERSION,
    metadata: { title: 'T', bpm: 120, createdAt: '2020-01-01T00:00:00.000Z', updatedAt: '2020-01-01T00:00:00.000Z' },
    audio: { fileName: 'x.wav', trim: { startSec: 0, endSec: 8 }, source: 'upload' },
    timeline: { bars, beats },
    sections: [],
    harmony: [],
    cueTracks: [],
  } as SongMap
}

function wavFile(name = 'x.wav'): File {
  const sr = 44100
  const n = sr * 2
  const bytes = new ArrayBuffer(44 + n * 2)
  const dv = new DataView(bytes)
  const A = (o: number, s: string) => {
    for (let i = 0; i < s.length; i++) dv.setUint8(o + i, s.charCodeAt(i))
  }
  A(0, 'RIFF')
  dv.setUint32(4, 36 + n * 2, true)
  A(8, 'WAVE')
  A(12, 'fmt ')
  dv.setUint32(16, 16, true)
  dv.setUint16(20, 1, true)
  dv.setUint16(22, 1, true)
  dv.setUint32(24, sr, true)
  dv.setUint32(28, sr * 2, true)
  dv.setUint16(32, 2, true)
  dv.setUint16(34, 16, true)
  A(36, 'data')
  dv.setUint32(40, n * 2, true)
  for (let i = 0; i < n; i++) dv.setInt16(44 + i * 2, Math.round(0.3 * 32767 * Math.sin((2 * Math.PI * 220 * i) / sr)), true)
  return new File([bytes], name, { type: 'audio/wav' })
}

async function freshTransport() {
  const mod = await import('$lib/audio/transport.svelte')
  return mod.transport
}

describe('the audition overlay on the real transport', () => {
  it('applies levels, then restores EXACTLY what it found', async () => {
    const t = await freshTransport()
    try {
      t.configure(makeSong())
      await t.loadFile(wavFile())
      await t.setStems([
        { key: 'stem:drums.wav', label: 'Drums', blob: wavFile('d.wav') },
        { key: 'stem:bass.wav', label: 'Bass', blob: wavFile('b.wav') },
      ])
      const before = new Map(t.engineTracksForTest().map((x) => [x.key, x.volume]))

      t.auditionMix({ original: 0.15, 'stem:drums.wav': 0.6, 'stem:bass.wav': 0.9 }, 0.5)
      const during = new Map(t.engineTracksForTest().map((x) => [x.key, x.volume]))
      expect(during.get('original')).toBeCloseTo(0.15, 6)
      expect(during.get('stem:drums.wav')).toBeCloseTo(0.6, 6)
      expect(t.auditionActive).toBe(true)

      t.clearAudition()
      for (const [key, v] of before) {
        expect(t.engineTracksForTest().find((x) => x.key === key)?.volume, key).toBeCloseTo(v, 6)
      }
      expect(t.auditionActive).toBe(false)
    } finally {
      t.dispose()
    }
  }, 30_000)

  it('re-applying tracks the FIRST snapshot — slider moves cannot poison the restore', async () => {
    const t = await freshTransport()
    try {
      t.configure(makeSong())
      await t.loadFile(wavFile())
      const original = t.engineTracksForTest().find((x) => x.key === 'original')!.volume
      // Slide, slide again, slide a third time — one snapshot underneath.
      t.auditionMix({ original: 0.2 })
      t.auditionMix({ original: 0.4 })
      t.auditionMix({ original: 0.7 })
      t.clearAudition()
      expect(t.engineTracksForTest().find((x) => x.key === 'original')!.volume).toBeCloseTo(original, 6)
    } finally {
      t.dispose()
    }
  }, 30_000)

  it('a song switch drops the audition — a preview never follows to the next song', async () => {
    const t = await freshTransport()
    try {
      t.configure(makeSong())
      await t.loadFile(wavFile('a.wav'))
      t.auditionMix({ original: 0.1 })
      expect(t.auditionActive).toBe(true)
      await t.loadFile(wavFile('b.wav'))
      expect(t.auditionActive).toBe(false)
      // The new song's track is at its own normal volume, not the preview's.
      expect(t.engineTracksForTest().find((x) => x.key === 'original')!.volume).toBeGreaterThan(0.5)
    } finally {
      t.dispose()
    }
  }, 30_000)

  it('double-clear is safe and clear-without-audition is a no-op', async () => {
    const t = await freshTransport()
    try {
      t.configure(makeSong())
      await t.loadFile(wavFile())
      t.clearAudition()
      t.clearAudition()
      expect(t.auditionActive).toBe(false)
    } finally {
      t.dispose()
    }
  }, 30_000)
})
