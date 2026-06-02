import { songStartBeat } from '$lib/audio/cueTrackSpeechSchedule'
import type { SongMap } from '$lib/songmap/types'

export type CountInResult = {
  prependSec: number
  beatDurationSec: number
  effectiveFirstDownbeatSec: number
}

/**
 * Compute how many seconds must be prepended before the (trimmed) audio file
 * so that `countInBeats` metronome clicks fit cleanly before the song start.
 *
 * The "song start" is `songStartBeat(sm)` — bar 1 beat 1 by default, or
 * whatever beat `sm.startBeatId` references. `beatDurationSec` is taken
 * from THAT beat's bar, not bar 1, so count-in spacing follows the local
 * meter when the override puts the start in a later bar.
 *
 * Returns null when the song map lacks enough timeline data.
 */
export function computeCountIn(songMap: SongMap, countInBeats: number): CountInResult | null {
  const { bars, beats } = songMap.timeline
  if (bars.length === 0 || beats.length === 0) return null

  const startBeat = songStartBeat(songMap)
  if (!startBeat) return null

  const startBar = bars.find((b) => b.id === startBeat.barId)
  if (!startBar || startBar.beatCount <= 0) return null
  const beatDurationSec = (startBar.endSec - startBar.startSec) / startBar.beatCount
  if (!Number.isFinite(beatDurationSec) || beatDurationSec <= 0) return null

  const trimStart = songMap.audio?.trim.startSec ?? 0
  const effectiveFirstDownbeatSec = startBeat.timeSec - trimStart
  const countInDuration = countInBeats * beatDurationSec
  const prependSec = Math.max(0, countInDuration - effectiveFirstDownbeatSec)

  return { prependSec, beatDurationSec, effectiveFirstDownbeatSec }
}
