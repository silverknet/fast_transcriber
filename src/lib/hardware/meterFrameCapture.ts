/**
 * MEASURING THE DESK'S METER FRAME — which index is what, from evidence.
 *
 * The XR18 sends a 40-value meter frame. Channels 1-16 at indices 0-15 are
 * proven; the BUS positions are in doubt (live evidence contradicted 22-27).
 * This module accumulates frames and reports which indices MOVE, so at a
 * rehearsal you play something into a known bus and read off where it lands.
 * Pure accumulation — the /debug/meters page owns the polling.
 */

export type MeterActivity = {
  index: number
  /** Highest level seen, dB. */
  peakDb: number
  /** Latest level, dB. */
  nowDb: number
  /** Has this index ever risen above the floor during the capture? */
  moved: boolean
}

const FLOOR_DB = -100

export function emptyActivity(size = 40): MeterActivity[] {
  return Array.from({ length: size }, (_, index) => ({
    index,
    peakDb: -128,
    nowDb: -128,
    moved: false,
  }))
}

/** Fold one frame into the running capture. Returns the same array, mutated. */
export function foldFrame(activity: MeterActivity[], frame: readonly number[]): MeterActivity[] {
  for (let i = 0; i < activity.length; i++) {
    const v = frame[i]
    if (typeof v !== 'number') continue
    const a = activity[i]!
    a.nowDb = v
    if (v > a.peakDb) a.peakDb = v
    if (v > FLOOR_DB) a.moved = true
  }
  return activity
}

/**
 * The report to read out loud at the rehearsal: every index that carried
 * signal, annotated with what the CURRENT map believes it is — agreements and
 * contradictions alike.
 */
export function activityReport(activity: readonly MeterActivity[]): string {
  const believed = (i: number): string => {
    if (i <= 15) return `ch ${i + 1}`
    if (i >= 22 && i <= 27) return `bus ${i - 21} (UNVERIFIED map)`
    if (i >= 28 && i <= 29) return `main ${i === 28 ? 'L' : 'R'} (unverified)`
    return 'unmapped'
  }
  const moved = activity.filter((a) => a.moved)
  if (moved.length === 0) return 'Nothing has moved yet — play something.'
  return moved
    .map((a) => `idx ${a.index}: peak ${a.peakDb.toFixed(1)} dB — believed ${believed(a.index)}`)
    .join('\n')
}
