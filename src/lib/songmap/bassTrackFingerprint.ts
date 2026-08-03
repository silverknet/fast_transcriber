/**
 * Staleness fingerprint for the RENDERED bass track (not the notes — note
 * freshness is `hasFreshBassMidi`'s job). Mirrors `drumTrackFingerprint.ts`;
 * bars/beats are hashed unconditionally for the same reason (prelude layout
 * + quantize grid both hang off them).
 */
import { titleCuePreludeSec } from '$lib/audio/cueTrackSpeechSchedule'
import { effectiveCountInBeats } from '$lib/songmap/countIn'
import { getPrimaryCueTrack } from '$lib/songmap/cueTracks'
import { sortBeatsByTime } from '$lib/songmap/normalize'
import type { SongMap } from '$lib/songmap/types'

function round6(n: number): number {
  return Math.round(n * 1e6) / 1e6
}

export function bassTrackFingerprintPayload(sm: SongMap): unknown {
  const trim = sm.audio?.trim ?? { startSec: 0, endSec: 0 }
  const bm = sm.bassMidi
  return {
    // v2: the detected bass gained a chosen VOICE (sound + tone), so those
    // have to be part of the identity — otherwise picking a different bass
    // leaves the saved render on disk looking fresh and the old sound keeps
    // playing, which is the stale-render trap this fingerprint exists for.
    v: 2,
    sound: bm?.sound ?? null,
    tone: bm?.tone ?? null,
    kickFollow: bm?.kickFollow ?? 0,
    kickNotes: bm?.kickNotes === true,
    events: (bm?.events ?? []).map((e) => ({
      t: round6(e.timeSec),
      d: round6(e.durationSec),
      m: e.midi,
      vel: round6(e.velocity),
    })),
    quantize: bm?.quantize ?? 'off',
    style: bm?.style ?? 'steady',
    trim: { startSec: round6(trim.startSec), endSec: round6(trim.endSec) },
    audioSha256: sm.audio?.sha256 ?? '',
    countInBeats: effectiveCountInBeats(sm),
    startBeatId: sm.startBeatId ?? null,
    titlePreludeSec: round6(titleCuePreludeSec(sm, getPrimaryCueTrack(sm))),
    bars: sm.timeline.bars.map((b) => ({
      i: b.index,
      s: round6(b.startSec),
      e: round6(b.endSec),
      n: b.meter.numerator,
      d: b.meter.denominator,
    })),
    beats: sortBeatsByTime(sm.timeline.beats).map((b) => ({
      id: b.id,
      t: round6(b.timeSec),
    })),
  }
}

/** Stable short fingerprint (djb2 hex, like the cue render fingerprint). */
export function fingerprintBassTrackInputs(sm: SongMap): string {
  const raw = JSON.stringify(bassTrackFingerprintPayload(sm))
  let h = 5381
  for (let i = 0; i < raw.length; i++) {
    h = (h * 33) ^ raw.charCodeAt(i)
  }
  return (h >>> 0).toString(16).padStart(8, '0')
}
