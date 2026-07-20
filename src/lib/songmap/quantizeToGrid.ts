/**
 * Subdivision quantizer for timed events against the song's beat grid.
 *
 * Built on the same half-open beat-span model as `beatAtTime.ts`: a beat owns
 * `[beat.timeSec, min(nextBeat.timeSec, bar.endSec))`. Subdividing the ACTUAL
 * span (not a BPM formula) makes this meter-agnostic — a 6/8 song's dotted
 * beat divides correctly, tempo drift follows the grid.
 *
 * Events before the first beat or after the last span pass through unchanged
 * (honest: no grid, no snap).
 */
import { beatAtTime } from './beatAtTime'
import type { Bar, Beat, DrumMidiEvent, DrumQuantize } from './types'

/** Slots per beat per division. 6 covers both 16th-triplets and 8th-triplets. */
export const SLOTS_PER_BEAT: Record<Exclude<DrumQuantize, 'off'>, number> = {
  '1/8': 2,
  '1/16': 4,
  '1/16T': 6,
}

export function quantizeTimesToGrid<T extends { timeSec: number }>(
  items: T[],
  beatsSorted: Beat[],
  barsById: Map<string, Bar>,
  division: Exclude<DrumQuantize, 'off'>,
): T[] {
  if (beatsSorted.length === 0) return items
  const slots = SLOTS_PER_BEAT[division]
  const firstBeatTime = beatsSorted[0]!.timeSec
  return items.map((item) => {
    const t = item.timeSec
    if (t < firstBeatTime) return item
    const beat = beatAtTime(beatsSorted, t)
    if (!beat) return item
    const idx = beatsSorted.indexOf(beat)
    const next = idx + 1 < beatsSorted.length ? beatsSorted[idx + 1] : null
    const barEnd = barsById.get(beat.barId)?.endSec ?? next?.timeSec ?? t
    const spanEnd = next ? Math.min(next.timeSec, barEnd) : barEnd
    const span = spanEnd - beat.timeSec
    if (!(span > 0)) return item
    if (!next && t >= spanEnd) return item // past the final beat span — no grid
    const slotW = span / slots
    // Rounding up to the span end lands on the NEXT beat's slot 0 — correct.
    const snapped = beat.timeSec + Math.round((t - beat.timeSec) / slotW) * slotW
    return { ...item, timeSec: snapped }
  })
}

/**
 * After snapping, hits of the same class can collide on one slot — keep one,
 * at the loudest velocity (a flam collapsed by the grid is one hit).
 */
export function dedupeDrumEvents(events: DrumMidiEvent[]): DrumMidiEvent[] {
  const out: DrumMidiEvent[] = []
  const lastByCls = new Map<string, DrumMidiEvent>()
  for (const e of [...events].sort((a, b) => a.timeSec - b.timeSec)) {
    const prev = lastByCls.get(e.cls)
    if (prev && Math.abs(prev.timeSec - e.timeSec) <= 0.001) {
      prev.velocity = Math.max(prev.velocity, e.velocity)
      continue
    }
    const copy = { ...e }
    out.push(copy)
    lastByCls.set(e.cls, copy)
  }
  return out
}
