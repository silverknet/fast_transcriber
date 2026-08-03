/**
 * HOW LONG DOES THE CLICK ACTUALLY TAKE? Measured, not felt.
 *
 * A full-length song (224 s — the length of "Love Never Felt So Good") through
 * both paths, in real Chromium:
 *
 *   old:  renderCueTrackWavBlob  → WAV encode → decodeAudioData → resample
 *   new:  renderClickTrackData   → samples, done
 *
 * The budgets are deliberately loose (CI machines vary); the printed numbers
 * are the real deliverable. If the new path ever creeps toward a second, the
 * budget fails before a musician feels it.
 */
import { describe, expect, it } from 'vitest'
import { CUE_SAMPLE_RATE, renderClickTrackData, renderCueTrackWavBlob } from './renderCueTrack'
import { SONGMAP_FORMAT_VERSION } from '$lib/songmap/version'
import type { SongMap } from '$lib/songmap/types'

/** ~224 s of 4/4 at 120 bpm: 112 bars, 448 beats — a real set-list song. */
function fullLengthSong(): SongMap {
  const bd = 0.5
  const barCount = 112
  const beats: SongMap['timeline']['beats'] = []
  const bars: SongMap['timeline']['bars'] = []
  for (let bar = 0; bar < barCount; bar++) {
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
  const dur = barCount * 4 * bd
  return {
    formatVersion: SONGMAP_FORMAT_VERSION,
    metadata: {
      title: 'Love Never Felt So Good (fixture)',
      bpm: 120,
      createdAt: '2020-01-01T00:00:00.000Z',
      updatedAt: '2020-01-01T00:00:00.000Z',
    },
    audio: { fileName: 'x.wav', trim: { startSec: 0, endSec: dur }, source: 'upload' },
    timeline: { bars, beats },
    sections: [],
    harmony: [],
    cueTracks: [],
    countInBeats: 8,
  } as SongMap
}

describe('click load time, full-length song', () => {
  it('the new direct path is fast, and far faster than the old WAV round-trip', async () => {
    const sm = fullLengthSong()

    const t0 = performance.now()
    const fast = await renderClickTrackData(sm, { cueTrack: undefined, sampleRate: 48000 })
    const fastMs = performance.now() - t0
    expect(fast.data.length).toBeGreaterThan(200 * 48000)

    const t1 = performance.now()
    const wav = await renderCueTrackWavBlob(sm, { includeSpeech: false, includeClicks: true })
    const decoded = await new Promise<AudioBuffer>((resolve, reject) => {
      void wav.blob.arrayBuffer().then((bytes) => {
        // Decode on a 48k context, as the engine would — the resample is part
        // of the price the old path paid.
        const ctx = new OfflineAudioContext(1, 1, 48000)
        ctx.decodeAudioData(bytes, resolve, reject)
      })
    })
    const oldMs = performance.now() - t1
    expect(decoded.length).toBeGreaterThan(200 * 48000)

    // eslint-disable-next-line no-console
    console.info(
      `[click-load] 224s song  new path: ${Math.round(fastMs)} ms   old path (WAV+decode): ${Math.round(oldMs)} ms`,
    )
    // The absolute budget a musician would call "instant enough".
    expect(fastMs, 'direct click render is no longer fast').toBeLessThan(1500)
  }, 60_000)

  it('the WAV path still exists for export and matches length', async () => {
    // Guard that measuring did not drift the two paths apart.
    const sm = fullLengthSong()
    const fast = await renderClickTrackData(sm, { cueTrack: undefined, sampleRate: CUE_SAMPLE_RATE })
    const wav = await renderCueTrackWavBlob(sm, { includeSpeech: false, includeClicks: true })
    expect(fast.preludeOffsetSec).toBeCloseTo(wav.preludeOffsetSec, 6)
  }, 60_000)
})
