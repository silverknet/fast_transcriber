import { titleCuePreludeSec } from '$lib/audio/cueTrackSpeechSchedule'
import { getPrimaryCueTrack } from '$lib/songmap/cueTracks'
import { songPlaybackPlan } from '$lib/songmap/playbackPlan'
import type { SongMap } from '$lib/songmap/types'

export type TransitionCountInWindow = {
  anchorMixerSec: number
  startMixerSec: number
  countInBeats: number
  usesCanonicalCountIn: boolean
}

/**
 * Locate the existing song count-in on the mixer's rendered click timeline.
 * A transition may reuse it only when its incoming anchor is the song's
 * canonical start beat. Arbitrary anchors do not get a guessed click pattern.
 */
export function transitionCountInWindow(
  songMap: SongMap,
  anchorOriginalSec: number,
  mixerSongOffsetSec: number,
): TransitionCountInWindow {
  const anchorMixerSec = Math.max(0, anchorOriginalSec + mixerSongOffsetSec)
  const plan = songPlaybackPlan(songMap)
  if (!plan || plan.countInBeats <= 0) {
    return { anchorMixerSec, startMixerSec: anchorMixerSec, countInBeats: 0, usesCanonicalCountIn: false }
  }

  const anchorToleranceSec = Math.max(0.06, plan.beatDurationSec * 0.15)
  if (Math.abs(anchorOriginalSec - plan.firstDownbeatOriginalSec) > anchorToleranceSec) {
    return { anchorMixerSec, startMixerSec: anchorMixerSec, countInBeats: 0, usesCanonicalCountIn: false }
  }

  const clickShiftSec = titleCuePreludeSec(songMap, getPrimaryCueTrack(songMap)) + plan.prependSec
  const countInMixerTimes = plan.clickPoints
    .filter((point) => point.isCountIn)
    .map((point) => point.timeSec + clickShiftSec)
    .filter((timeSec) => Number.isFinite(timeSec) && timeSec < anchorMixerSec - 1e-4)

  if (countInMixerTimes.length === 0) {
    return { anchorMixerSec, startMixerSec: anchorMixerSec, countInBeats: 0, usesCanonicalCountIn: false }
  }

  return {
    anchorMixerSec,
    startMixerSec: Math.max(0, Math.min(...countInMixerTimes)),
    countInBeats: countInMixerTimes.length,
    usesCanonicalCountIn: true,
  }
}

export type TransitionPreludeSchedule = {
  sourceStartCtxTime: number
  anchorCtxTime: number
  announcementCtxTime: number | null
  lateBySec: number
}

/**
 * Place announcement -> count-in -> incoming anchor on one AudioContext clock.
 * If loading finished too late, the whole prelude moves together; count-in is
 * never shortened to pretend the original handoff was still achievable.
 */
export function scheduleTransitionPrelude(input: {
  nowCtxTime: number
  requestedAnchorCtxTime: number
  startMixerSec: number
  anchorMixerSec: number
  playbackRate: number
  announcementDurationSec?: number
  announcementGapSec?: number
  engineLookaheadSec?: number
}): TransitionPreludeSchedule {
  const rate = Number.isFinite(input.playbackRate) && input.playbackRate > 0 ? input.playbackRate : 1
  const preRollWallSec = Math.max(0, input.anchorMixerSec - input.startMixerSec) / rate
  const announcementDurationSec = Math.max(0, input.announcementDurationSec ?? 0)
  const announcementGapSec = announcementDurationSec > 0
    ? Math.max(0, input.announcementGapSec ?? 0.15)
    : 0
  const announcementLeadSec = announcementDurationSec + announcementGapSec
  const lookaheadSec = Math.max(0, input.engineLookaheadSec ?? 0.04)

  const requestedSourceStart = input.requestedAnchorCtxTime - preRollWallSec
  const requestedTimelineStart = requestedSourceStart - announcementLeadSec
  const earliestTimelineStart = input.nowCtxTime + lookaheadSec
  const lateBySec = Math.max(0, earliestTimelineStart - requestedTimelineStart)
  const sourceStartCtxTime = requestedSourceStart + lateBySec

  return {
    sourceStartCtxTime,
    anchorCtxTime: input.requestedAnchorCtxTime + lateBySec,
    announcementCtxTime:
      announcementDurationSec > 0 ? sourceStartCtxTime - announcementLeadSec : null,
    lateBySec,
  }
}
