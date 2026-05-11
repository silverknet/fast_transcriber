import { sortBeatsByTime } from '$lib/songmap/normalize'
import type { SongMap } from '$lib/songmap/types'

function round6(n: number): number {
  return Math.round(n * 1e6) / 1e6
}

/**
 * Canonical payload for cue-track alignment. Any change here should invalidate
 * a previously rendered cue WAV.
 */
export function cueTrackFingerprintPayload(sm: SongMap): unknown {
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
    v: 1,
    trim: { startSec: round6(trim.startSec), endSec: round6(trim.endSec) },
    audioSha256: sm.audio?.sha256 ?? '',
    cues: {
      mode: sm.cues.mode,
      countInBeats: sm.cues.countInBeats,
      prependSec: sm.cues.prependSec !== undefined ? round6(sm.cues.prependSec) : null,
    },
    bars,
    beats,
    sections,
  }
}

/** Stable short fingerprint (sync, for patch + UI). */
export function fingerprintCueTrackInputs(sm: SongMap): string {
  const raw = JSON.stringify(cueTrackFingerprintPayload(sm))
  let h = 5381
  for (let i = 0; i < raw.length; i++) {
    h = (h * 33) ^ raw.charCodeAt(i)
  }
  return (h >>> 0).toString(16).padStart(8, '0')
}
