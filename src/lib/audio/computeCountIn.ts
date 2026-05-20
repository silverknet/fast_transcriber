import type { SongMap } from '$lib/songmap/types'

export type CountInResult = {
  prependSec: number
  beatDurationSec: number
  effectiveFirstDownbeatSec: number
}

/**
 * Compute how many seconds must be prepended before the (trimmed) audio file
 * so that `countInBeats` metronome clicks fit cleanly before bar 1.
 *
 * Returns null when the song map lacks enough timeline data.
 */
export function computeCountIn(songMap: SongMap, countInBeats: number): CountInResult | null {
  const { bars, beats } = songMap.timeline
  if (bars.length === 0 || beats.length === 0) return null

  const firstBar = bars[0]!
  if (firstBar.beatCount <= 0) return null
  const beatDurationSec = (firstBar.endSec - firstBar.startSec) / firstBar.beatCount
  if (!Number.isFinite(beatDurationSec) || beatDurationSec <= 0) return null

  const firstDownbeat = beats.find((b) => b.indexInBar === 0)
  if (!firstDownbeat) return null

  const trimStart = songMap.audio?.trim.startSec ?? 0
  const effectiveFirstDownbeatSec = firstDownbeat.timeSec - trimStart
  const countInDuration = countInBeats * beatDurationSec
  const prependSec = Math.max(0, countInDuration - effectiveFirstDownbeatSec)

  return { prependSec, beatDurationSec, effectiveFirstDownbeatSec }
}
