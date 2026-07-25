/**
 * Explain WHY a lyrics fit came out well or badly, in user language.
 *
 * `alignLyricsToTranscription` already returns the honest quality signal —
 * `matchedRows / totalRows` (rows placed by real evidence vs interpolated). But a
 * low number alone doesn't tell the user what to DO. Measurement across a real
 * library (see AGENT_NOTES 2026-07-25) found low fits fall into distinct causes:
 *
 *   • the vocal track is too quiet/buried → the recognizer hears almost nothing
 *     (Leva-livet: vocal stem ~9 dB below its siblings → 1% placed, unfixable by
 *     a better model);
 *   • recognition was weak (wrong-language detection, hard singing) → a better
 *     model / language hint recovers it (Den-första: 7% → 69%);
 *   • recognition was fine but the sheet doesn't match what's sung.
 *
 * This is a PURE classifier — it takes the alignment counts plus, optionally, the
 * measured loudness of the vocal source — and returns a diagnosis with
 * user-facing copy. No internals leak into the strings.
 */

export type FitQuality = 'good' | 'partial' | 'weak-recognition' | 'quiet-vocals' | 'no-fit'

export type FitDiagnosis = {
  quality: FitQuality
  /** rows placed by evidence ÷ total rows, 0..1 */
  rowCoverage: number
  /** short user-facing summary */
  headline: string
  /** one-line, actionable where possible */
  detail: string
}

export type FitCounts = {
  matchedRows: number
  totalRows: number
  /** fraction of words anchored, 0..1 (optional, refines the message) */
  matchedRatio?: number
}

export type FitContext = {
  /** Mean loudness of the vocal source in dBFS (e.g. ffmpeg volumedetect mean_volume). */
  vocalDbfsMean?: number
}

// Rows placed by evidence, below which the fit is mostly guesswork.
const GOOD_COVERAGE = 0.75
const PARTIAL_COVERAGE = 0.45
const NO_FIT_COVERAGE = 0.1
// A vocal source this quiet on average has little for the recognizer to grab.
// Calibrated against real stems: healthy vocals sit near -17..-19 dB mean; a
// buried stem measured -26.9 dB and produced ~nothing.
const QUIET_VOCAL_DBFS = -24

/**
 * Classify a fit outcome. `context.vocalDbfsMean`, when known, lets us tell a
 * "the audio was too quiet" story apart from "the recognizer struggled".
 */
export function diagnoseFit(counts: FitCounts, context: FitContext = {}): FitDiagnosis {
  const total = Math.max(0, counts.totalRows)
  const matched = Math.max(0, Math.min(counts.matchedRows, total || counts.matchedRows))
  const rowCoverage = total > 0 ? matched / total : 0
  const quietVocals =
    typeof context.vocalDbfsMean === 'number' && context.vocalDbfsMean < QUIET_VOCAL_DBFS

  if (total > 0 && rowCoverage >= GOOD_COVERAGE) {
    return {
      quality: 'good',
      rowCoverage,
      headline: 'Lyrics fit the song',
      detail: 'Most lines are placed to the audio; a few may be estimated between them.',
    }
  }

  if (rowCoverage >= PARTIAL_COVERAGE) {
    return {
      quality: 'partial',
      rowCoverage,
      headline: 'Partial fit',
      detail:
        'About half the lines are placed to the audio and the rest are estimated. You can nudge timing by hand where it drifts.',
    }
  }

  // Low coverage — separate "quiet audio" from "weak recognition".
  if (quietVocals) {
    return {
      quality: 'quiet-vocals',
      rowCoverage,
      headline: 'Vocal track is very quiet',
      detail:
        'The singing is too low in this audio for the timing to lock on. Try a version with clearer vocals, or re-separate the stems.',
    }
  }

  if (rowCoverage < NO_FIT_COVERAGE) {
    return {
      quality: 'no-fit',
      rowCoverage,
      headline: 'Could not fit the lyrics',
      detail:
        'Almost no lines matched the audio. Check that these are the right lyrics for this recording, or try a version with clearer vocals.',
    }
  }

  return {
    quality: 'weak-recognition',
    rowCoverage,
    headline: 'Rough fit',
    detail:
      'Only some lines matched the audio, so most timing is estimated. A clearer vocal source usually helps most.',
  }
}
