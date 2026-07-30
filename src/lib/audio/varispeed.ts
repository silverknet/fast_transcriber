/**
 * NAIVE transpose — varispeed, the tape-machine kind.
 *
 * Play the audio faster and it gets higher; slower and it gets lower. That is
 * the whole algorithm: one `AudioBufferSourceNode.playbackRate`. No phase
 * vocoder, no formant correction, no WASM, no render pass, no waiting. Pitch
 * and tempo move together — a +2 semitone transpose is also ~12% faster, and
 * that is the accepted trade (see `clientPitchShift.ts` for the tempo-preserving
 * variant and its cost).
 *
 * ## The audio is never modified
 *
 * This is the load-bearing property. There is NO transformed buffer anywhere:
 * the engine plays the ORIGINAL decoded `AudioBuffer` and only sets a rate
 * scalar on the source node. Nothing is rendered, cached, written to disk, or
 * pushed into the `.smap`. Consequently:
 *
 *     transpose(-n) ∘ transpose(+n) === identity
 *
 * holds EXACTLY, not approximately — and it holds for a reason worth stating,
 * because the obvious implementation gets it wrong. The state we keep is the
 * INTEGER semitone offset, never an accumulated rate. Going +2 then −2 computes
 * `varispeedRate(0)`, which is exactly `1`; it never multiplies 1.122… by
 * 0.8908…, which in IEEE-754 lands a hair off 1 and would leave the audio
 * imperceptibly but permanently detuned after a round trip. Round-tripping the
 * rate is lossy; round-tripping the semitone is not.
 *
 * ## Time bases
 *
 * The `.smap` — beats, bars, sections, chords, click points — stays in ORIGINAL
 * audio time and is never rescaled. What changes is only how buffer-time maps to
 * wall-clock time:
 *
 *     wall seconds = buffer seconds / rate
 *
 * So the playhead keeps being reported in original time and every grid consumer
 * stays correct with no changes at all; only the buffer↔context conversions
 * inside the engine (and the click scheduler, which converts plan-time deltas
 * into context-time offsets) need to divide by the rate.
 */

/** Equal temperament: twelve equal steps per octave. */
const SEMITONES_PER_OCTAVE = 12

/**
 * Playback rate for a semitone offset. `0 → exactly 1` (bit-identical
 * playback), `+12 → 2` (an octave up, twice the speed), `−12 → 0.5`.
 *
 * Takes the SEMITONE — always recompute from it rather than composing rates,
 * or the round-trip identity above stops being exact.
 */
export function varispeedRate(semitones: number): number {
  if (!Number.isFinite(semitones) || semitones === 0) return 1
  return Math.pow(2, semitones / SEMITONES_PER_OCTAVE)
}

/** Inverse of {@link varispeedRate} — the semitone offset a rate represents. */
export function varispeedSemitones(rate: number): number {
  if (!Number.isFinite(rate) || rate <= 0) return 0
  return SEMITONES_PER_OCTAVE * Math.log2(rate)
}

/**
 * How long `bufferSec` of audio takes to play at `rate`, in wall-clock seconds.
 * Use at every buffer-time → context-time boundary.
 */
export function bufferSecToWallSec(bufferSec: number, rate: number): number {
  return rate > 0 ? bufferSec / rate : bufferSec
}

/**
 * How much audio elapses in `wallSec` of wall-clock time, in buffer seconds.
 * Use at every context-time → buffer-time boundary (i.e. the playhead).
 */
export function wallSecToBufferSec(wallSec: number, rate: number): number {
  return wallSec * rate
}

/**
 * Percentage tempo change a transpose implies, for UI ("+12% faster").
 * Purely informational — nothing derives timing from this.
 */
export function varispeedTempoPercent(semitones: number): number {
  return (varispeedRate(semitones) - 1) * 100
}

// ── Partial tempo hold ─────────────────────────────────────────────────────

/**
 * How the transpose is split between resampling and time-stretching.
 *
 * Resampling (`rate`) is free and artifact-free but drags tempo along with
 * pitch. Time-stretching (`shiftSemitones`, done by the live Signalsmith
 * worklet) buys the tempo back, and is the ONLY source of artifacts. So we hand
 * the stretcher as little work as possible:
 *
 *     play at 2^(n(1-h)/12)  →  pitch and tempo both up by n(1-h)
 *     shift up by n·h        →  pitch up the remaining n·h, tempo untouched
 *     ─────────────────────────────────────────────────────────────────────
 *     net: pitch +n, tempo ×2^(n(1-h)/12)
 *
 * `h` (tempo hold) is the dial the artifacts scale with:
 *   - `h = 0` → pure varispeed. Perfect audio, full tempo change, worklet BYPASSED.
 *   - `h = 1` → rate 1, full pitch shift. Tempo preserved, most artifacts.
 *   - between → the stretcher only works `n·h` semitones instead of `n`.
 *
 * Both endpoints are EXACT, which is what keeps the round trip exact: at `h = 0`
 * the shift is exactly 0 (node bypassed, original samples), and at `n = 0` both
 * come out neutral regardless of `h`.
 */
export interface VarispeedPlan {
  /** `AudioBufferSourceNode.playbackRate` — resampling half of the transpose. */
  rate: number
  /** Semitones for the live stretch node. Exactly 0 means "bypass it". */
  shiftSemitones: number
}

/** Clamp the tempo-hold dial to 0…1 (0 = pure varispeed, 1 = keep tempo). */
export function clampTempoHold(hold: number): number {
  if (!Number.isFinite(hold)) return 0
  return Math.max(0, Math.min(1, hold))
}

export function varispeedPlan(semitones: number, tempoHold: number): VarispeedPlan {
  const n = Number.isFinite(semitones) ? semitones : 0
  const h = clampTempoHold(tempoHold)
  if (n === 0) return { rate: 1, shiftSemitones: 0 }
  // `+ 0` normalises -0 (from a negative transpose at h = 0) to 0. `shift === 0`
  // is the bypass sentinel, and -0 reads as "not zero" to Object.is/toBe even
  // though it compares equal with ===. Keep the sentinel unambiguous.
  return { rate: varispeedRate(n * (1 - h)), shiftSemitones: n * h + 0 }
}

/**
 * Resulting tempo change percentage for a transpose held by `tempoHold`.
 * At `h = 1` this is 0 — the song keeps its original tempo.
 */
export function heldTempoPercent(semitones: number, tempoHold: number): number {
  return (varispeedPlan(semitones, tempoHold).rate - 1) * 100
}
