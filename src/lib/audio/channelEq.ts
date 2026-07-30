/**
 * Per-channel EQ — a console channel strip, one per mixer lane.
 *
 * Four fixed bands plus a high-pass, which is what a channel EQ on a desk gives
 * you and what 95% of live mixing needs:
 *
 *   HPF ──► LOW (shelf) ──► LOW-MID (peak) ──► HIGH-MID (peak) ──► HIGH (shelf)
 *
 * Fixed ROLES rather than a free list of bands: the stored shape stays small and
 * stable, the popover always shows the same four columns in the same places, and
 * there is no "add a band" state to design around. Each band's frequency is
 * still movable, so a "low-mid" can sit anywhere from 100 Hz to 1 kHz.
 *
 * This is an INSERT, not a bus — it belongs to one lane and is heard only on
 * that lane. Playback processing only: no audio file is ever rewritten.
 *
 * Native Web Audio biquads, so the same builder works in a live `AudioContext`
 * and an `OfflineAudioContext` (which is how the response is measured in tests
 * rather than asserted by ear).
 */

export type EqBandId = 'low' | 'lowMid' | 'highMid' | 'high'

export interface EqBand {
  /** Centre / corner frequency in Hz. */
  freq: number
  /** Cut or boost in dB. 0 = flat (the band is then skipped entirely). */
  gain: number
  /** Bandwidth for the peaking bands. Ignored by the shelves. */
  q?: number
}

export interface ChannelEq {
  /** Master bypass for this lane's EQ. Absent = on (a stored EQ is meant to sound). */
  enabled?: boolean
  /** High-pass corner in Hz. 0 / absent = no high-pass. */
  hpf?: number
  low?: EqBand
  lowMid?: EqBand
  highMid?: EqBand
  high?: EqBand
}

/** Band order = signal order, low to high. */
export const EQ_BAND_IDS: readonly EqBandId[] = ['low', 'lowMid', 'highMid', 'high']

export const EQ_BAND_LABELS: Record<EqBandId, string> = {
  low: 'Low',
  lowMid: 'Lo-mid',
  highMid: 'Hi-mid',
  high: 'High',
}

/** Filter type per band role. */
export const EQ_BAND_TYPES: Record<EqBandId, BiquadFilterType> = {
  low: 'lowshelf',
  lowMid: 'peaking',
  highMid: 'peaking',
  high: 'highshelf',
}

/** Frequency travel per band — overlapping, so any band can cover its neighbour. */
export const EQ_BAND_RANGE: Record<EqBandId, { min: number; max: number }> = {
  low: { min: 40, max: 320 },
  lowMid: { min: 120, max: 1200 },
  highMid: { min: 800, max: 6000 },
  high: { min: 3000, max: 16000 },
}

export const EQ_GAIN_LIMIT_DB = 15
export const EQ_HPF_MIN = 20
export const EQ_HPF_MAX = 400
export const EQ_Q_MIN = 0.3
export const EQ_Q_MAX = 6

/** Flat starting point — every band at its home frequency, no gain, no HPF. */
export function defaultChannelEq(): ChannelEq {
  return {
    enabled: true,
    hpf: 0,
    low: { freq: 90, gain: 0 },
    lowMid: { freq: 350, gain: 0, q: 1 },
    highMid: { freq: 2500, gain: 0, q: 1 },
    high: { freq: 9000, gain: 0 },
  }
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v))

function clampBand(id: EqBandId, band: EqBand | undefined): EqBand | undefined {
  if (!band || typeof band !== 'object') return undefined
  const range = EQ_BAND_RANGE[id]
  const freq = Number.isFinite(band.freq) ? clamp(band.freq, range.min, range.max) : range.min
  const gain = Number.isFinite(band.gain) ? clamp(band.gain, -EQ_GAIN_LIMIT_DB, EQ_GAIN_LIMIT_DB) : 0
  const out: EqBand = { freq, gain }
  if (EQ_BAND_TYPES[id] === 'peaking') {
    out.q = Number.isFinite(band.q) ? clamp(band.q as number, EQ_Q_MIN, EQ_Q_MAX) : 1
  }
  return out
}

/**
 * Coerce anything persisted (or arriving from a collaborator on a different
 * build) into a valid EQ. Never throws — a malformed band becomes flat rather
 * than taking the whole song down.
 */
export function clampChannelEq(raw: unknown): ChannelEq | undefined {
  if (!raw || typeof raw !== 'object') return undefined
  const o = raw as Record<string, unknown>
  const out: ChannelEq = {}
  if (typeof o.enabled === 'boolean') out.enabled = o.enabled
  if (typeof o.hpf === 'number' && Number.isFinite(o.hpf) && o.hpf > 0) {
    out.hpf = clamp(o.hpf, EQ_HPF_MIN, EQ_HPF_MAX)
  }
  for (const id of EQ_BAND_IDS) {
    const band = clampBand(id, o[id] as EqBand | undefined)
    if (band) out[id] = band
  }
  return out
}

/** Is this EQ doing anything audible? A flat, bypassed or empty EQ builds nothing. */
export function isEqActive(eq: ChannelEq | undefined): boolean {
  if (!eq) return false
  if (eq.enabled === false) return false
  if ((eq.hpf ?? 0) >= EQ_HPF_MIN) return true
  return EQ_BAND_IDS.some((id) => {
    const g = eq[id]?.gain ?? 0
    return Math.abs(g) > 0.05
  })
}

/** Is this EQ worth storing at all? Same test, ignoring the bypass switch, so
 *  a deliberately-bypassed non-flat EQ is still remembered. */
export function isEqWorthStoring(eq: ChannelEq | undefined): boolean {
  if (!eq) return false
  if (eq.enabled === false) return true
  return isEqActive(eq)
}

export interface AudioChain {
  input: AudioNode
  output: AudioNode
}

/**
 * Build the biquad chain for one lane, or `null` when the EQ is flat/bypassed —
 * a flat EQ costs zero nodes rather than four transparent ones.
 *
 * Only bands with non-zero gain are built, so a single low-shelf boost is one
 * filter, not four.
 */
export function buildChannelEqChain(ctx: BaseAudioContext, eq: ChannelEq | undefined): AudioChain | null {
  if (!isEqActive(eq) || !eq) return null

  let input: AudioNode | null = null
  let prev: AudioNode | null = null
  const push = (node: AudioNode) => {
    if (prev) prev.connect(node)
    if (!input) input = node
    prev = node
  }

  const hpf = eq.hpf ?? 0
  if (hpf >= EQ_HPF_MIN) {
    const f = ctx.createBiquadFilter()
    f.type = 'highpass'
    f.frequency.value = clamp(hpf, EQ_HPF_MIN, EQ_HPF_MAX)
    f.Q.value = 0.707 // Butterworth — flat passband, no resonant bump at the corner
    push(f)
  }

  for (const id of EQ_BAND_IDS) {
    const band = eq[id]
    if (!band || Math.abs(band.gain) <= 0.05) continue
    const range = EQ_BAND_RANGE[id]
    const f = ctx.createBiquadFilter()
    f.type = EQ_BAND_TYPES[id]
    f.frequency.value = clamp(band.freq, range.min, range.max)
    f.gain.value = clamp(band.gain, -EQ_GAIN_LIMIT_DB, EQ_GAIN_LIMIT_DB)
    if (f.type === 'peaking') f.Q.value = clamp(band.q ?? 1, EQ_Q_MIN, EQ_Q_MAX)
    push(f)
  }

  return input && prev ? { input, output: prev } : null
}

/** A live EQ whose settings can be changed without rebuilding the graph. */
export interface ChannelEqNodes extends AudioChain {
  update(eq: ChannelEq | undefined): void
}

/**
 * The LIVE counterpart to `buildChannelEqChain`: a FIXED set of filters whose
 * parameters are retuned in place.
 *
 * Why fixed rather than only building the bands in use: replacing a track's
 * insert mid-playback disconnects the old chain, so the lane drops out until the
 * transport re-seeks. Dragging an EQ slider would then restart the audio on
 * every tick. With a fixed shape, a drag is just five `AudioParam` writes and is
 * heard immediately, with no re-seek and no gap.
 *
 * A band at 0 dB and a high-pass parked at 20 Hz are transparent, so the idle
 * cost of the extra filters is inaudible — this is only used for lanes that
 * have an EQ at all.
 */
export function createChannelEqNodes(ctx: BaseAudioContext): ChannelEqNodes {
  const hp = ctx.createBiquadFilter()
  hp.type = 'highpass'
  hp.frequency.value = EQ_HPF_MIN
  hp.Q.value = 0.707

  const bands = EQ_BAND_IDS.map((id) => {
    const f = ctx.createBiquadFilter()
    f.type = EQ_BAND_TYPES[id]
    f.frequency.value = EQ_BAND_RANGE[id].min
    f.gain.value = 0
    if (f.type === 'peaking') f.Q.value = 1
    return { id, filter: f }
  })

  let prev: AudioNode = hp
  for (const b of bands) {
    prev.connect(b.filter)
    prev = b.filter
  }

  const update = (eq: ChannelEq | undefined) => {
    const on = isEqActive(eq)
    // Bypass = park every filter somewhere transparent rather than rewiring.
    const hpf = on ? (eq?.hpf ?? 0) : 0
    hp.frequency.value = hpf >= EQ_HPF_MIN ? clamp(hpf, EQ_HPF_MIN, EQ_HPF_MAX) : EQ_HPF_MIN
    for (const { id, filter } of bands) {
      const band = on ? eq?.[id] : undefined
      const range = EQ_BAND_RANGE[id]
      filter.frequency.value = band ? clamp(band.freq, range.min, range.max) : range.min
      filter.gain.value = band ? clamp(band.gain, -EQ_GAIN_LIMIT_DB, EQ_GAIN_LIMIT_DB) : 0
      if (filter.type === 'peaking') filter.Q.value = clamp(band?.q ?? 1, EQ_Q_MIN, EQ_Q_MAX)
    }
  }

  return { input: hp, output: prev, update }
}
