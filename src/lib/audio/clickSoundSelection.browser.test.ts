import { describe, expect, it } from 'vitest'
import { playLegacyMetronomeClick, playMetronomeClick } from './debugClickTrack'
import { renderCueTrackWavBlob } from './renderCueTrack'
import type { SongMap } from '$lib/songmap/types'
import { SONGMAP_FORMAT_VERSION } from '$lib/songmap/version'

async function renderClick(legacy: boolean): Promise<Float32Array> {
  const sampleRate = 44_100
  const ctx = new OfflineAudioContext(1, Math.round(sampleRate * 0.15), sampleRate)
  const play = legacy ? playLegacyMetronomeClick : playMetronomeClick
  play(ctx, ctx.destination, 0.01, true)
  const rendered = await ctx.startRendering()
  return new Float32Array(rendered.getChannelData(0))
}

function peak(samples: Float32Array): number {
  let value = 0
  for (const sample of samples) value = Math.max(value, Math.abs(sample))
  return value
}

function songWithFourBeats(): SongMap {
  const barId = 'bar-1'
  const beatIds = ['beat-1', 'beat-2', 'beat-3', 'beat-4']
  return {
    formatVersion: SONGMAP_FORMAT_VERSION,
    metadata: {
      title: 'Click render',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    },
    audio: {
      fileName: 'source.wav',
      trim: { startSec: 0, endSec: 2 },
      source: 'upload',
    },
    timeline: {
      bars: [{
        id: barId,
        index: 0,
        startSec: 0,
        endSec: 2,
        meter: { numerator: 4, denominator: 4 },
        beatCount: 4,
        beatIds,
      }],
      beats: beatIds.map((id, indexInBar) => ({
        id,
        barId,
        indexInBar,
        timeSec: indexInBar * 0.5,
      })),
    },
    sections: [],
    harmony: [],
    cueTracks: [],
  }
}

describe('project click sound selection', () => {
  it('uses an audible Hybrid voice while retaining a distinct legacy beep', async () => {
    const hybrid = await renderClick(false)
    const legacy = await renderClick(true)

    expect(peak(hybrid)).toBeGreaterThan(0.1)
    expect(peak(legacy)).toBeGreaterThan(0.1)
    expect(hybrid).not.toEqual(legacy)
  })

  it('renders the Hybrid voice into click-track WAVs', async () => {
    const result = await renderCueTrackWavBlob(songWithFourBeats(), {
      includeClicks: true,
      includeSpeech: false,
    })
    const decodeContext = new OfflineAudioContext(1, 1, 44_100)
    const decoded = await decodeContext.decodeAudioData(await result.blob.arrayBuffer())

    expect(decoded.duration).toBeCloseTo(2, 2)
    expect(peak(decoded.getChannelData(0))).toBeGreaterThan(0.1)
  })
})
