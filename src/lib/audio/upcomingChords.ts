/**
 * The phone live "chord row": the chord playing now + the next few, derived from
 * the same `chordTimelineSegments` the mixer uses. Kept pure so the look-ahead
 * behaviour is testable without the mixer/engine.
 *
 * Why a row and not just "current + 1": when chords come fast (several per bar)
 * one look-ahead is too little to read; when it's one chord per bar, showing a few
 * ahead is harmless. Non-chord (rest) segments are skipped so the row is always
 * real chords.
 */
export interface ChordSegmentLike {
  id: string
  label: string
  startSec: number
  endSec: number
  hasChord: boolean
}

export interface ChordRowItem {
  id: string
  label: string
  isCurrent: boolean
  /** 0–100, the fraction of the CURRENT chord already elapsed (0 for upcoming). */
  progressPct: number
}

/**
 * Returns the current chord + the next `count` chord-bearing segments (so up to
 * `count + 1` items). "Current" is the chord whose span contains `positionSec`;
 * in a rest or before the first chord, the next upcoming chord becomes the head.
 */
export function upcomingChordRow(
  segments: readonly ChordSegmentLike[],
  positionSec: number,
  count: number,
): ChordRowItem[] {
  const chords = segments.filter((s) => s.hasChord).slice().sort((a, b) => a.startSec - b.startSec)
  if (chords.length === 0) return []

  let currentIdx = chords.findIndex(
    (s) => positionSec >= s.startSec - 1e-6 && positionSec < s.endSec - 1e-6,
  )
  if (currentIdx === -1) {
    const nextIdx = chords.findIndex((s) => s.startSec >= positionSec - 1e-6)
    currentIdx = nextIdx === -1 ? chords.length - 1 : nextIdx
  }

  const row: ChordRowItem[] = []
  const end = Math.min(chords.length, currentIdx + count + 1)
  for (let i = currentIdx; i < end; i++) {
    const seg = chords[i]!
    const isCurrent = i === currentIdx
    let progressPct = 0
    if (isCurrent) {
      const span = seg.endSec - seg.startSec
      progressPct = span > 0 ? Math.min(100, Math.max(0, ((positionSec - seg.startSec) / span) * 100)) : 0
    }
    row.push({ id: seg.id, label: seg.label, isCurrent, progressPct })
  }
  return row
}
