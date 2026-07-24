import { titleCuePreludeSec } from '$lib/audio/cueTrackSpeechSchedule'
import { effectiveCountInBeats } from '$lib/songmap/countIn'
import { getPrimaryCueTrack } from '$lib/songmap/cueTracks'
import { sortBeatsByTime } from '$lib/songmap/normalize'
import type { CueTrack, SongMap } from '$lib/songmap/types'

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

export function cueTrackFingerprintPayload(sm: SongMap, track: CueTrack | undefined = getPrimaryCueTrack(sm)): unknown {
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
    v: 7, // bumped: count-in speech now onset-aligned (trimLeadingSilence)
    trim: { startSec: round6(trim.startSec), endSec: round6(trim.endSec) },
    audioSha256: sm.audio?.sha256 ?? '',
    countInBeats: effectiveCountInBeats(sm),
    startBeatId: sm.startBeatId ?? null,
    cueTrack: stripRenderExport(track),
    titlePreludeSec: round6(titleCuePreludeSec(sm, track)),
    spokenIntroText:
      track?.events.find((event) => event.enabled && event.kind === 'intro')?.text?.trim() ?? null,
    bars,
    beats,
    sections,
  }
}

/** Stable short fingerprint (sync, for patch + UI). */
export function fingerprintCueTrackInputs(sm: SongMap, track?: CueTrack): string {
  const raw = JSON.stringify(cueTrackFingerprintPayload(sm, track))
  let h = 5381
  for (let i = 0; i < raw.length; i++) {
    h = (h * 33) ^ raw.charCodeAt(i)
  }
  return (h >>> 0).toString(16).padStart(8, '0')
}
