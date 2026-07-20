/**
 * Staleness fingerprint for the RENDERED drum track (not the events — event
 * freshness is `hasFreshDrumMidi`'s job). Mirrors `cueTrackFingerprint.ts`.
 *
 * Bars/beats are hashed unconditionally: they drive the prelude/prepend
 * layout AND the quantize grid. For `quantize: 'off'` this over-invalidates
 * on grid edits, which is fine — the mixer lane re-synthesizes in memory for
 * free; only the saved WAV is marked stale.
 */
import { titleCuePreludeSec } from '$lib/audio/cueTrackSpeechSchedule'
import { effectiveCountInBeats } from '$lib/songmap/countIn'
import { getPrimaryCueTrack } from '$lib/songmap/cueTracks'
import { sortBeatsByTime } from '$lib/songmap/normalize'
import type { SongMap } from '$lib/songmap/types'

function round6(n: number): number {
  return Math.round(n * 1e6) / 1e6
}

export function drumTrackFingerprintPayload(sm: SongMap): unknown {
  const trim = sm.audio?.trim ?? { startSec: 0, endSec: 0 }
  const dm = sm.drumMidi
  return {
    // v2: stereo mix bus (pan + reverb + glue compression + saturation) —
    // saved renders from the dry engine must re-render.
    v: 2,
    events: (dm?.events ?? []).map((e) => ({
      t: round6(e.timeSec),
      c: e.cls,
      vel: round6(e.velocity),
    })),
    kit: dm?.kit ?? 'synth',
    quantize: dm?.quantize ?? 'off',
    style: dm?.style ?? 'steady',
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
export function fingerprintDrumTrackInputs(sm: SongMap): string {
  const raw = JSON.stringify(drumTrackFingerprintPayload(sm))
  let h = 5381
  for (let i = 0; i < raw.length; i++) {
    h = (h * 33) ^ raw.charCodeAt(i)
  }
  return (h >>> 0).toString(16).padStart(8, '0')
}
