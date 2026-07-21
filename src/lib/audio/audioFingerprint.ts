/**
 * Recording identity — "is this the same performance?", not "is this the same file?".
 *
 * `sha256` answers a different question than the one collaboration asks. Two
 * bandmates can hold the SAME recording as a 48 kHz WAV and a 320 kbps MP3:
 * different bytes, different file size, different sha — but identical musical
 * content at identical time offsets, so the same bar/beat grid fits both. The
 * byte-level check calls that a mismatch, which trains people to click through
 * the warning, which is how a genuinely wrong file eventually gets in.
 *
 * Conversely the loose check (duration + sampleRate + channels + fileSize) can
 * PASS for two different masters of the same song — `audioReconcile.ts` already
 * notes this and refuses to auto-stamp on a loose match.
 *
 * What actually matters for BarBro is that the timeline fits: `Bar.startSec` and
 * `Beat.timeSec` are absolute seconds into the audio. A different edit, a
 * different intro count-in, or a version with 2 s of extra head silence makes
 * every stored time wrong — silently, because nothing re-checks after import.
 *
 * So the fingerprint captures the shape of the recording over time: a coarse
 * loudness envelope, in dB, min-max normalised, quantised to bytes. Compared
 * with a Pearson correlation, which is invariant to scale and offset. That
 * makes it:
 *
 *   - robust to codec, bitrate, sample rate, channel count and gain — the
 *     things that legitimately differ between collaborators;
 *   - sensitive to different edits, masters with different arrangement, and
 *     any shift in where the music sits in the file — the things that break
 *     the grid.
 *
 * It is NOT a security primitive and NOT a music-recognition system. It answers
 * one narrow question: would the stored bars and beats still land correctly on
 * this audio?
 */

/** Bumped only if the envelope maths changes shape-incompatibly. */
export const AUDIO_FINGERPRINT_VERSION = 1 as const

/**
 * Envelope resolution. 64 buckets over a 3-minute song is ~2.8 s per bucket —
 * coarse enough that MP3 encoder delay (~26 ms) is invisible, fine enough to
 * separate different arrangements. Fixed COUNT rather than fixed duration so
 * two envelopes are always directly comparable; differing lengths are caught by
 * the duration gate instead.
 */
export const AUDIO_FINGERPRINT_BUCKETS = 64

/**
 * How far two durations may differ and still be "the same recording". Generous
 * enough for container padding and encoder delay, far tighter than the gap
 * between a radio edit and an album cut.
 */
export const FINGERPRINT_DURATION_TOLERANCE_SEC = 1.0

/**
 * Correlation at or above this counts as the same recording. Tuned against the
 * cases in `audioFingerprint.test.ts`: transcodes and gain changes land ~1.0,
 * a different arrangement lands well below.
 */
export const FINGERPRINT_MATCH_THRESHOLD = 0.85

export type AudioFingerprint = {
  version: typeof AUDIO_FINGERPRINT_VERSION
  /** Decoded duration in seconds. */
  durationSec: number
  /** `AUDIO_FINGERPRINT_BUCKETS` loudness buckets, 0–255. */
  envelope: number[]
}

/** Floor for the dB conversion so digital silence doesn't produce -Infinity. */
const SILENCE_FLOOR = 1e-6

/**
 * Build a fingerprint from decoded PCM. Channels are averaged to mono first, so
 * a stereo file and its mono bounce fingerprint alike.
 *
 * Returns `null` for empty or zero-length input rather than a degenerate
 * fingerprint that would falsely match other silence.
 */
export function computeAudioFingerprint(
  channels: Float32Array[],
  sampleRate: number,
): AudioFingerprint | null {
  if (channels.length === 0 || sampleRate <= 0) return null
  const frames = channels[0]!.length
  if (frames === 0) return null

  const buckets = AUDIO_FINGERPRINT_BUCKETS
  const db = new Float64Array(buckets)

  for (let b = 0; b < buckets; b++) {
    const start = Math.floor((b * frames) / buckets)
    const end = Math.max(start + 1, Math.floor(((b + 1) * frames) / buckets))
    let sumSquares = 0
    let count = 0
    for (let i = start; i < end && i < frames; i++) {
      // Mono mixdown, averaged across whatever channels exist.
      let sample = 0
      for (const ch of channels) sample += ch[i] ?? 0
      sample /= channels.length
      sumSquares += sample * sample
      count++
    }
    const rms = count > 0 ? Math.sqrt(sumSquares / count) : 0
    // dB rather than linear: loudness differences between masters compress the
    // top of a linear scale and would dominate the correlation.
    db[b] = 20 * Math.log10(rms + SILENCE_FLOOR)
  }

  let min = Infinity
  let max = -Infinity
  for (const v of db) {
    if (v < min) min = v
    if (v > max) max = v
  }

  const envelope = new Array<number>(buckets)
  const span = max - min
  if (span <= 0) {
    // Perfectly flat (digital silence, or a constant tone). No shape to
    // compare; store zeroes and let `fingerprintSimilarity` report undecided.
    envelope.fill(0)
  } else {
    for (let b = 0; b < buckets; b++) {
      envelope[b] = Math.round(((db[b]! - min) / span) * 255)
    }
  }

  return {
    version: AUDIO_FINGERPRINT_VERSION,
    // Round to milliseconds: more precision than that is decoder noise and
    // would only churn the sync fingerprint.
    durationSec: Math.round((frames / sampleRate) * 1000) / 1000,
    envelope,
  }
}

/**
 * Pearson correlation of two envelopes, in −1…1. Scale- and offset-invariant,
 * so a quiet transcode of a loud master still scores ~1.
 *
 * Returns `null` when the comparison is meaningless: different envelope
 * lengths, an incompatible version, or either side being flat (no variance).
 */
export function fingerprintSimilarity(
  a: AudioFingerprint | undefined,
  b: AudioFingerprint | undefined,
): number | null {
  if (!a || !b) return null
  if (a.version !== b.version) return null
  const n = a.envelope.length
  if (n === 0 || n !== b.envelope.length) return null

  let meanA = 0
  let meanB = 0
  for (let i = 0; i < n; i++) {
    meanA += a.envelope[i]!
    meanB += b.envelope[i]!
  }
  meanA /= n
  meanB /= n

  let cov = 0
  let varA = 0
  let varB = 0
  for (let i = 0; i < n; i++) {
    const da = a.envelope[i]! - meanA
    const db = b.envelope[i]! - meanB
    cov += da * db
    varA += da * da
    varB += db * db
  }
  if (varA <= 0 || varB <= 0) return null
  return cov / Math.sqrt(varA * varB)
}

export type FingerprintVerdict =
  /** Same recording — the stored bars and beats fit this audio. */
  | 'same'
  /** Definitely a different recording — the grid will not line up. */
  | 'different'
  /** Not enough information (one side has no fingerprint, or it's flat). */
  | 'undecided'

/**
 * Compare two recordings. Duration is gated FIRST and independently: two
 * different cuts of a song can have similar loudness shapes, and a minute of
 * extra outro is decisive on its own.
 */
export function compareFingerprints(
  a: AudioFingerprint | undefined,
  b: AudioFingerprint | undefined,
): FingerprintVerdict {
  if (!a || !b) return 'undecided'
  if (a.version !== b.version) return 'undecided'
  if (Math.abs(a.durationSec - b.durationSec) > FINGERPRINT_DURATION_TOLERANCE_SEC) {
    return 'different'
  }
  const similarity = fingerprintSimilarity(a, b)
  if (similarity === null) return 'undecided'
  return similarity >= FINGERPRINT_MATCH_THRESHOLD ? 'same' : 'different'
}
