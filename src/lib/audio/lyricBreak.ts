/**
 * Detect a "breathing room" gap between sung lyric lines so the live view can
 * show a countdown to the next entry instead of holding a stale line through a
 * long instrumental break.
 *
 * A gap only counts when it is at least `minGapSec` long — normal line-to-line
 * spacing is a beat or two and must NOT trigger it. The intro before the first
 * line counts as a gap too (previous end = 0), so a long intro gets the same
 * "come in in N…" countdown.
 *
 * Pure + generic over any line carrying `startSec`/`endSec`.
 */
export type LyricBreakState<T> = {
  /** Inside a gap at least `minGapSec` long. */
  active: boolean
  /** Seconds until the next line's first word (>= 0). */
  untilSec: number
  /** Seconds since the previous line ended (>= 0). */
  elapsedSec: number
  /** Total length of the current gap (seconds). */
  gapSec: number
  /** Progress through the gap, 0..1 (0 = just started, 1 = about to sing). */
  progress: number
  /** The line the countdown is toward, for an upcoming-line preview. */
  nextLine: T | null
}

function idle<T>(): LyricBreakState<T> {
  return { active: false, untilSec: 0, elapsedSec: 0, gapSec: 0, progress: 0, nextLine: null }
}

export function lyricBreakState<T extends { startSec: number; endSec: number }>(
  lines: readonly T[],
  songTime: number,
  opts: { minGapSec?: number } = {},
): LyricBreakState<T> {
  const minGap = opts.minGapSec ?? 6
  if (lines.length === 0) return idle<T>()

  // First line that hasn't started yet — the countdown target.
  let ni = -1
  for (let i = 0; i < lines.length; i++) {
    if (lines[i]!.startSec > songTime) {
      ni = i
      break
    }
  }
  if (ni < 0) return idle<T>() // past the last line — nothing to count down to
  const next = lines[ni]!
  const prev = ni > 0 ? lines[ni - 1]! : null

  // Still inside the previous line (it hasn't ended) → not a gap.
  if (prev && songTime <= prev.endSec) return idle<T>()

  const prevEnd = prev ? prev.endSec : 0 // before the first line, gap runs from 0
  const gapSec = next.startSec - prevEnd
  if (gapSec < minGap) return idle<T>()

  const untilSec = Math.max(0, next.startSec - songTime)
  const elapsedSec = Math.max(0, songTime - prevEnd)
  const progress = gapSec > 0 ? Math.min(1, Math.max(0, elapsedSec / gapSec)) : 0
  return { active: true, untilSec, elapsedSec, gapSec, progress, nextLine: next }
}
