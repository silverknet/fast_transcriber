import { describe, expect, it } from 'vitest'
import { defaultCueSettings } from '$lib/songmap/defaults'
import type { SongMap } from '$lib/songmap/types'
import { SONGMAP_FORMAT_VERSION } from '$lib/songmap/version'
import { computeCountIn } from './computeCountIn'
import { mixTimelineClickPoints } from './mixSongCuePreview'

/** First bar pickup: downbeat at 1s; count-in grid overlaps pickup beats in the prepend region. */
function mapPickupFourFour(): SongMap {
  const barId = 'b0'
  const beatIds = ['bb0', 'bb1', 'bb2', 'bb3']
  return {
    formatVersion: SONGMAP_FORMAT_VERSION,
    metadata: { title: 'X', createdAt: '2020-01-01T00:00:00.000Z', updatedAt: '2020-01-01T00:00:00.000Z' },
    audio: { fileName: 'x.wav', trim: { startSec: 0, endSec: 10 }, source: 'upload' },
    timeline: {
      bars: [
        {
          id: barId,
          index: 0,
          startSec: 0,
          endSec: 2,
          meter: { numerator: 4, denominator: 4 },
          beatCount: 4,
          beatIds,
        },
      ],
      beats: beatIds.map((id, i) => ({
        id,
        barId,
        indexInBar: i,
        timeSec: 0.5 + i * 0.5,
      })),
    },
    sections: [],
    harmony: [],
    cues: { ...defaultCueSettings(), mode: 'countIn', countInBeats: 4 },
  }
}

describe('mixTimelineClickPoints', () => {
  it('does not stack pickup beats on top of count-in grid clicks', () => {
    const sm = mapPickupFourFour()
    const ci = computeCountIn(sm, 4)
    expect(ci).not.toBeNull()
    const pts = mixTimelineClickPoints(sm, 0, 10, ci!.prependSec)
    const byT = new Map<number, number>()
    for (const p of pts) {
      const k = Math.round(p.timeSec * 1000)
      byT.set(k, (byT.get(k) ?? 0) + 1)
    }
    const dup = [...byT.entries()].filter(([, n]) => n > 1)
    expect(dup).toEqual([])
  })
})
