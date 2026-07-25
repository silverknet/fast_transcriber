export const APC_KEY_25_MK2_NAME_RE = /apc\s*key\s*25/i

export const APC_TRACK_BUTTON_BASE = 0x40
export const APC_SCENE_LAUNCH_BASE = 0x52
export const APC_STOP_ALL_CLIPS_NOTE = 0x51
export const APC_PLAY_NOTE = 0x5b
export const APC_RECORD_NOTE = 0x5d
export const APC_SHIFT_NOTE = 0x62
export const APC_KNOB_CC_BASE = 0x30
export const APC_CLIP_PAD_COUNT = 40
export const APC_CLIP_PAD_COLUMNS = 8
export const APC_CLIP_PAD_ROWS = 5
export const APC_RGB_LED_SOLID_100_STATUS = 0x96

export type ApcKey25Action =
  | { type: 'track-button'; index: number; pressed: boolean }
  | { type: 'scene-launch'; index: number; pressed: boolean }
  | { type: 'stop-all-clips'; pressed: boolean }
  | { type: 'play'; pressed: boolean }
  | { type: 'record'; pressed: boolean }
  | { type: 'shift'; pressed: boolean }
  | { type: 'clip-pad'; index: number; row: number; col: number; pressed: boolean; velocity: number }
  | { type: 'knob'; index: number; delta: number; rawValue: number }

export type ApcSingleLedState = 'off' | 'on' | 'blink'
export type ApcClipPadLedColor = 'off' | 'dim' | 'green' | 'red' | 'yellow' | 'orange' | 'blue' | 'white'

const APC_CLIP_PAD_COLOR_VELOCITY: Record<ApcClipPadLedColor, number> = {
  off: 0x00,
  dim: 0x01,
  white: 0x03,
  red: 0x05,
  orange: 0x09,
  yellow: 0x0d,
  green: 0x15,
  blue: 0x2d,
}

export function isLikelyApcKey25Mk2Name(name: string | null | undefined): boolean {
  return APC_KEY_25_MK2_NAME_RE.test(name ?? '')
}

/**
 * True ONLY for the APC Key 25's CONTROL port (pads / scene / transport / knobs).
 *
 * The mk2 exposes its 25-key piano keybed as a SEPARATE input port named
 * "APC Key 25 mk2 Keys" — playing it must not drive live commands. Returns false
 * for that keybed port and for any non-APC device; a bare "APC Key 25" (a
 * single-port setup) still counts as control.
 */
export function isApcKey25ControlPortName(name: string | null | undefined): boolean {
  const n = name ?? ''
  return isLikelyApcKey25Mk2Name(n) && !/\bkeys\b/i.test(n)
}

/**
 * True for the APC Key 25's piano-KEYBED port ("APC Key 25 mk2 Keys"). The
 * inverse concern of {@link isApcKey25ControlPortName}: the in-app synth listens
 * to THIS port (note on/off + velocity), never the control surface.
 */
export function isApcKey25KeysPortName(name: string | null | undefined): boolean {
  const n = name ?? ''
  return isLikelyApcKey25Mk2Name(n) && /\bkeys\b/i.test(n)
}

export function parseApcKey25Message(dataLike: ArrayLike<number>): ApcKey25Action | null {
  if (dataLike.length < 3) return null
  const status = dataLike[0]! & 0xff
  const data1 = dataLike[1]! & 0x7f
  const data2 = dataLike[2]! & 0x7f
  const kind = status & 0xf0

  if (kind === 0xb0) {
    if (data1 >= APC_KNOB_CC_BASE && data1 < APC_KNOB_CC_BASE + 8) {
      return {
        type: 'knob',
        index: data1 - APC_KNOB_CC_BASE,
        delta: relativeCcDelta(data2),
        rawValue: data2,
      }
    }
    return null
  }

  const isNoteOn = kind === 0x90 && data2 > 0
  const isNoteOff = kind === 0x80 || (kind === 0x90 && data2 === 0)
  if (!isNoteOn && !isNoteOff) return null
  const pressed = isNoteOn

  if (data1 >= APC_TRACK_BUTTON_BASE && data1 < APC_TRACK_BUTTON_BASE + 8) {
    return { type: 'track-button', index: data1 - APC_TRACK_BUTTON_BASE, pressed }
  }
  if (data1 >= APC_SCENE_LAUNCH_BASE && data1 < APC_SCENE_LAUNCH_BASE + 5) {
    return { type: 'scene-launch', index: data1 - APC_SCENE_LAUNCH_BASE, pressed }
  }
  if (data1 === APC_STOP_ALL_CLIPS_NOTE) return { type: 'stop-all-clips', pressed }
  if (data1 === APC_PLAY_NOTE) return { type: 'play', pressed }
  if (data1 === APC_RECORD_NOTE) return { type: 'record', pressed }
  if (data1 === APC_SHIFT_NOTE) return { type: 'shift', pressed }
  if (data1 >= 0x00 && data1 < APC_CLIP_PAD_COUNT) {
    return {
      type: 'clip-pad',
      index: data1,
      row: Math.floor(data1 / APC_CLIP_PAD_COLUMNS),
      col: data1 % APC_CLIP_PAD_COLUMNS,
      pressed,
      velocity: data2,
    }
  }
  return null
}

export function relativeCcDelta(value: number): number {
  const v = value & 0x7f
  if (v === 0 || v === 64) return 0
  if (v < 64) return v
  return v - 128
}

export function adjustApcLaneVolume(current: number, delta: number, step = 0.025): number {
  if (!Number.isFinite(current)) current = 1
  if (!Number.isFinite(delta)) delta = 0
  return Math.max(0, Math.min(1.5, current + delta * step))
}

// ── Knob engine: self-detecting absolute/relative + soft pickup ─────────────
//
// The APC Key 25's knobs are 270° pots that send ABSOLUTE CC values in their
// default mode; some setups remap them to relative (two's-complement) mode.
// Interpreting absolute values as relative deltas produces violent volume
// jumps (raw 100 → "−28") — unacceptable live. The engine watches the raw
// values: anything in 4..60 / 68..124 can ONLY be absolute (relative
// encodings emit small values around 0/64/128), so one mid-range message
// locks absolute mode. Until then, messages are treated as BOUNDED relative
// deltas — an absolute pot near rest yields tiny deltas, so the ambiguous
// phase is safe either way.
//
// Absolute mode uses SOFT PICKUP: a knob only takes control of a lane once
// it crosses (or lands near) the lane's current value — switching banks or
// songs never yanks a fader to wherever the physical knob happens to sit.

export const APC_KNOB_VOLUME_MAX = 1.5
/** Max relative ticks applied per message while mode is unknown/relative. */
const KNOB_RELATIVE_MAX_TICKS = 3
/** Soft-pickup capture window (linear volume units, of 0..1.5). */
const KNOB_PICKUP_TOLERANCE = 0.08

export type ApcKnobMode = 'unknown' | 'absolute' | 'relative'

export type ApcKnobEngine = {
  readonly mode: ApcKnobMode
  /**
   * Feed one knob message; returns the lane's NEW volume, or null when the
   * message must not move anything (soft pickup not engaged yet).
   */
  next(knobIndex: number, rawValue: number, currentVolume: number): number | null
  /** Drop pickup latches (call when the lanes under the knobs change). */
  dropPickup(): void
}

export function createApcKnobEngine(): ApcKnobEngine {
  let mode: ApcKnobMode = 'unknown'
  const pickedUp = new Set<number>()
  const lastRaw = new Map<number, number>()

  const isDefinitelyAbsolute = (v: number) => (v >= 4 && v <= 60) || (v >= 68 && v <= 124)

  return {
    get mode() {
      return mode
    },
    dropPickup() {
      pickedUp.clear()
      lastRaw.clear()
    },
    next(knobIndex: number, rawValue: number, currentVolume: number): number | null {
      const raw = rawValue & 0x7f
      const current = Number.isFinite(currentVolume)
        ? Math.max(0, Math.min(APC_KNOB_VOLUME_MAX, currentVolume))
        : 1

      if (mode !== 'absolute' && isDefinitelyAbsolute(raw)) mode = 'absolute'

      if (mode === 'absolute') {
        const target = (raw / 127) * APC_KNOB_VOLUME_MAX
        const prev = lastRaw.get(knobIndex)
        lastRaw.set(knobIndex, raw)
        if (!pickedUp.has(knobIndex)) {
          const currentRaw = (current / APC_KNOB_VOLUME_MAX) * 127
          const near = Math.abs(target - current) <= KNOB_PICKUP_TOLERANCE
          const crossed =
            prev !== undefined &&
            ((prev <= currentRaw && raw >= currentRaw) || (prev >= currentRaw && raw <= currentRaw))
          if (!near && !crossed) return null
          pickedUp.add(knobIndex)
        }
        return target
      }

      // Unknown/relative: bounded delta so even a mis-guess can't jump far.
      const delta = relativeCcDelta(raw)
      if (delta === 0) return null
      const bounded = Math.max(-KNOB_RELATIVE_MAX_TICKS, Math.min(KNOB_RELATIVE_MAX_TICKS, delta))
      return adjustApcLaneVolume(current, bounded)
    },
  }
}

export function apcSingleLedMessage(note: number, state: ApcSingleLedState): number[] {
  const velocity = state === 'off' ? 0x00 : state === 'blink' ? 0x02 : 0x01
  return [0x90, note & 0x7f, velocity]
}

export function apcTrackButtonLedMessage(index: number, state: ApcSingleLedState): number[] {
  if (!Number.isInteger(index) || index < 0 || index > 7) {
    throw new Error('APC track button index must be 0..7')
  }
  return apcSingleLedMessage(APC_TRACK_BUTTON_BASE + index, state)
}

export function apcSceneLaunchLedMessage(index: number, state: ApcSingleLedState): number[] {
  if (!Number.isInteger(index) || index < 0 || index > 4) {
    throw new Error('APC scene launch index must be 0..4')
  }
  return apcSingleLedMessage(APC_SCENE_LAUNCH_BASE + index, state)
}

export function apcClipPadLedMessage(index: number, color: ApcClipPadLedColor): number[] {
  if (!Number.isInteger(index) || index < 0 || index >= APC_CLIP_PAD_COUNT) {
    throw new Error('APC clip pad index must be 0..39')
  }
  return [APC_RGB_LED_SOLID_100_STATUS, index, APC_CLIP_PAD_COLOR_VELOCITY[color]]
}

export function midiBytesHex(dataLike: ArrayLike<number>): string {
  return Array.from({ length: dataLike.length }, (_, i) =>
    (dataLike[i]! & 0xff).toString(16).padStart(2, '0').toUpperCase(),
  ).join(' ')
}
