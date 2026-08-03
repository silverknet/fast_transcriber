import { titleCuePreludeSec } from '$lib/audio/cueTrackSpeechSchedule'
import { effectiveCountInBeats } from '$lib/songmap/countIn'
import { getPrimaryCueTrack } from '$lib/songmap/cueTracks'
import { sortBeatsByTime } from '$lib/songmap/normalize'
import type { CueTrack, SongMap } from '$lib/songmap/types'

/** Change only when the audible click renderer changes. */
export const CLICK_TRACK_RENDER_VERSION = 'hybrid-v1'

function round6(n: number): number {
  return Math.round(n * 1e6) / 1e6
}

/**
 * Canonical payload for cue-track alignment. Any change here should invalidate
 * a previously rendered cue WAV.
 */
function stripRenderExport(track: CueTrack | undefined): unknown {
  if (!track) return null
  return {
    id: track.id,
    name: track.name,
    enabled: track.enabled,
    voiceId: track.voiceId ?? null,
    spokenCountIn: track.spokenCountIn ?? false,
    suppressedGeneratedKeys: [...track.suppressedGeneratedKeys].sort(),
    events: track.events.map((event) => ({
      id: event.id,
      kind: event.kind,
      enabled: event.enabled,
      anchor: event.anchor,
      text: event.text ?? null,
      generatedKey: event.generatedKey ?? null,
      generatedSource: event.generatedSource ?? null,
      source: event.source ?? null,
      edited: event.edited ?? false,
      stale: event.stale ?? false,
    })),
  }
}

export function cueTrackFingerprintPayload(
  sm: SongMap,
  track: CueTrack | undefined = getPrimaryCueTrack(sm),
  opts: { announceTitle?: boolean } = {},
): unknown {
  const trim = sm.audio?.trim ?? { startSec: 0, endSec: 0 }
  const bars = sm.timeline.bars.map((b) => ({
    i: b.index,
    s: round6(b.startSec),
    e: round6(b.endSec),
    n: b.meter.numerator,
    d: b.meter.denominator,
    bc: b.beatCount,
    bids: [...b.beatIds],
  }))
  const beats = sortBeatsByTime(sm.timeline.beats).map((b) => ({
    id: b.id,
    bar: b.barId,
    t: round6(b.timeSec),
    iib: b.indexInBar,
  }))
  const sections = sm.sections.map((s) => ({
    k: s.kind,
    l: s.label,
    s: s.barRange.startBarIndex,
    e: s.barRange.endBarIndex,
  }))

  return {
    v: 8, // bumped: title announcement is DERIVED from the project setting
    announceTitle: !!opts.announceTitle,
    trim: { startSec: round6(trim.startSec), endSec: round6(trim.endSec) },
    audioSha256: sm.audio?.sha256 ?? '',
    countInBeats: effectiveCountInBeats(sm),
    startBeatId: sm.startBeatId ?? null,
    cueTrack: stripRenderExport(track),
    titlePreludeSec: round6(titleCuePreludeSec(sm, track, opts)),
    spokenIntroText:
      track?.events.find((event) => event.enabled && event.kind === 'intro')?.text?.trim() ?? null,
    bars,
    beats,
    sections,
  }
}

/** Stable short fingerprint (sync, for patch + UI). */
export function fingerprintCueTrackInputs(
  sm: SongMap,
  track?: CueTrack,
  opts: { announceTitle?: boolean } = {},
): string {
  return shortFingerprint(cueTrackFingerprintPayload(sm, track, opts))
}

export function clickTrackFingerprintPayload(
  sm: SongMap,
  track: CueTrack | undefined = getPrimaryCueTrack(sm),
): unknown {
  return {
    cueInputs: cueTrackFingerprintPayload(sm, track),
    clickRenderer: CLICK_TRACK_RENDER_VERSION,
  }
}

/** Cue timing plus the click renderer version, used only for click WAV freshness. */
export function fingerprintClickTrackInputs(sm: SongMap, track?: CueTrack): string {
  return shortFingerprint(clickTrackFingerprintPayload(sm, track))
}

function shortFingerprint(payload: unknown): string {
  const raw = JSON.stringify(payload)
  let h = 5381
  for (let i = 0; i < raw.length; i++) {
    h = (h * 33) ^ raw.charCodeAt(i)
  }
  return (h >>> 0).toString(16).padStart(8, '0')
}
