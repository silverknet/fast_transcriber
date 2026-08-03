/**
 * THE FAST CLICK PATH IS THE SAME CLICK TRACK.
 *
 * `renderClickTrackData` exists so the mixer and live mode get their click in
 * well under a second — samples straight from the offline render, no 20 MB WAV
 * encode, no `decodeAudioData`, no 44.1 → 48 kHz resample.
 *
 * A faster path that drifted from `renderCueTrackWavBlob` would be worse than
 * the slow one: the WAV path is what Ableton export and the disk cache play, and
 * CLAUDE.md invariant 4 is that what you hear IS what the export plays. So this
 * locks the two as one click track — same layout offset, clicks at the same
 * moments — and pins the speed claim's foundation (no decode) by construction.
 */
import { describe, expect, it } from 'vitest'
import { CUE_SAMPLE_RATE, renderClickTrackData, renderCueTrackWavBlob } from './renderCueTrack'
import { songPlaybackPlan } from '$lib/songmap/playbackPlan'
import { SONGMAP_FORMAT_VERSION } from '$lib/songmap/version'
import type { SongMap } from '$lib/songmap/types'

function makeSong(opts: { countInBeats?: number } = {}): SongMap {
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
    ...(opts.countInBeats ? { countInBeats: opts.countInBeats } : {}),
  } as SongMap
}

/** RMS energy in a small window around `sec`. */
function energyAt(data: Float32Array, sampleRate: number, sec: number, windowSec = 0.03): number {
  const from = Math.max(0, Math.floor((sec - windowSec / 2) * sampleRate))
  const to = Math.min(data.length, Math.ceil((sec + windowSec / 2) * sampleRate))
  let sum = 0
  for (let i = from; i < to; i++) sum += data[i]! * data[i]!
  return Math.sqrt(sum / Math.max(1, to - from))
}

describe('renderClickTrackData mirrors the WAV click track', () => {
  it('places a click at every plan point, and silence between them', async () => {
    const sm = makeSong()
    const plan = songPlaybackPlan(sm)!
    const r = await renderClickTrackData(sm, { cueTrack: undefined, sampleRate: 48000 })
    for (const c of plan.clickPoints) {
      const t = c.timeSec + r.preludeOffsetSec
      expect(energyAt(r.data, r.sampleRate, t), `no click at ${t.toFixed(2)}s`).toBeGreaterThan(0.01)
      // Between this beat and the next: near-silence, or the "click" is a drone.
      expect(energyAt(r.data, r.sampleRate, t + 0.25, 0.02)).toBeLessThan(0.005)
    }
  })

  it('reports the same layout offset as the WAV path, with and without a count-in', async () => {
    for (const countInBeats of [undefined, 4]) {
      const sm = makeSong({ countInBeats })
      const fast = await renderClickTrackData(sm, { cueTrack: undefined, sampleRate: CUE_SAMPLE_RATE })
      const wav = await renderCueTrackWavBlob(sm, { includeSpeech: false, includeClicks: true })
      expect(fast.preludeOffsetSec).toBeCloseTo(wav.preludeOffsetSec, 6)
    }
  })

  it('clicks land at the same moments as the decoded WAV, sample rate be damned', async () => {
    // The WAV renders at 44.1 kHz; the fast path at whatever the engine runs.
    // Same song must click at the same SECONDS on both.
    const sm = makeSong({ countInBeats: 4 })
    const plan = songPlaybackPlan(sm)!
    const fast = await renderClickTrackData(sm, { cueTrack: undefined, sampleRate: 48000 })
    const wav = await renderCueTrackWavBlob(sm, { includeSpeech: false, includeClicks: true })
    const decoded = await new Promise<AudioBuffer>((resolve, reject) => {
      void wav.blob.arrayBuffer().then((bytes) => {
        const ctx = new OfflineAudioContext(1, 1, CUE_SAMPLE_RATE)
        ctx.decodeAudioData(bytes, resolve, reject)
      })
    })
    const wavData = decoded.getChannelData(0)
    for (const c of plan.clickPoints) {
      const t = c.timeSec + fast.preludeOffsetSec
      const fastHit = energyAt(fast.data, fast.sampleRate, t) > 0.01
      const wavHit = energyAt(wavData, decoded.sampleRate, t) > 0.01
      expect(fastHit, `fast path missing click at ${t.toFixed(2)}s`).toBe(true)
      expect(wavHit, `wav path missing click at ${t.toFixed(2)}s`).toBe(true)
    }
  })

  it('a count-in makes the buffer longer by exactly the prepend', async () => {
    const plain = await renderClickTrackData(makeSong(), { cueTrack: undefined, sampleRate: 48000 })
    const counted = await renderClickTrackData(makeSong({ countInBeats: 4 }), {
      cueTrack: undefined,
      sampleRate: 48000,
    })
    // 4 beats at 120 bpm = 2 s of new lead-in.
    expect(counted.data.length - plain.data.length).toBeCloseTo(2 * 48000, -2)
    expect(counted.preludeOffsetSec).toBeCloseTo(2, 6)
  })
})
